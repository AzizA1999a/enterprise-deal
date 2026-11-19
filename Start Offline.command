#!/bin/zsh
# Double-click to run the simulation on this laptop with no internet.
# Close this window to stop it.
cd "$(dirname "$0")"
( sleep 1; open "http://localhost:8765/host.html?offline=1" ) &
python3 -m http.server 8765 --bind 127.0.0.1
