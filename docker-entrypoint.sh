#!/bin/sh
set -e

# Automatically launch Xvfb on :99 inside container if DISPLAY is not already provided
if [ -z "$DISPLAY" ]; then
  export DISPLAY=:99
  Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp -ac +extension GLX +render -noreset &
  XVFB_PID=$!

  # Bounded wait for Xvfb socket readiness
  for i in $(seq 1 30); do
    if [ -S /tmp/.X11-unix/X99 ]; then
      break
    fi
    sleep 0.1
  done
fi

# Cleanup handler on container shutdown to eliminate zombie processes
cleanup() {
  if [ -n "$XVFB_PID" ]; then
    kill -TERM "$XVFB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Hand off process execution to container command with PID 1 signal forwarding
exec "$@"
