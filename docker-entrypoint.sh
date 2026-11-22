#!/bin/sh
set -e

# 0. Self-bootstrap under tini init process if running as PID 1 to guarantee zero zombie child processes
if [ "$$" -eq 1 ] && [ -x "/usr/bin/tini" ]; then
  exec /usr/bin/tini -- "$0" "$@"
fi

# 1. Clean up any stale X11 lock files and UNIX domain sockets from previous container runs or unexpected restarts
rm -f /tmp/.X*-lock /tmp/.X11-unix/X* 2>/dev/null || true

# 2. Clean up any stale Google Chrome singleton locks from persistent profile
PROFILE_DIR="${BROWSER_USER_DATA_DIR:-/root/.cache/mcp-web-research/chrome-profile}"
if [ -d "$PROFILE_DIR" ]; then
  rm -f "$PROFILE_DIR/SingletonLock" \
        "$PROFILE_DIR/SingletonCookie" \
        "$PROFILE_DIR/SingletonSocket" 2>/dev/null || true
fi

# 3. Automatically launch Xvfb on the configured virtual display if DISPLAY is not already provided.
#    XVFB_DISPLAY lets host-networked containers avoid colliding with the host's abstract X socket on :99.
if [ -z "$DISPLAY" ]; then
  export DISPLAY="${XVFB_DISPLAY:-:99}"
  XVFB_NUM="${DISPLAY#:}"
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 -nolisten tcp -ac +extension GLX +render -noreset &
  XVFB_PID=$!

  # Bounded wait for Xvfb socket readiness AND verified process liveness
  READY=0
  for i in $(seq 1 30); do
    if [ -S "/tmp/.X11-unix/X${XVFB_NUM}" ] && kill -0 "$XVFB_PID" 2>/dev/null; then
      READY=1
      break
    fi
    if ! kill -0 "$XVFB_PID" 2>/dev/null; then
      echo "[ERROR] Xvfb daemon terminated unexpectedly during bootstrap." >&2
      break
    fi
    sleep 0.1
  done

  if [ "$READY" -ne 1 ]; then
    echo "[ERROR] Failed to initialize Xvfb on virtual display ${DISPLAY} within timeout." >&2
    exit 1
  fi
fi

# Cleanup handler on container shutdown to eliminate zombie processes
cleanup() {
  if [ -n "$XVFB_PID" ]; then
    kill -TERM "$XVFB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Hand off process execution to container command with signal forwarding
exec "$@"
