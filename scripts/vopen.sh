#!/bin/bash

# Usage: workdir /path/to/dir

# Get the target directory, default to $HOME if not provided
DIR="${1:-$HOME}"
# Get the desired session name, if not provided, default to the current directory name
SESSION_NAME="${2:-$(basename "$DIR")}"

tmux new-session -d -c "$DIR" -s "$SESSION_NAME" # start detached session in DIR
# Split horizontally (-v) so the new pane is below, focus goes to it
tmux split-window -v -c "$DIR"
# Resize the bottom pane (current pane) up by 15 lines (i.e. make it 15 lines tall)
tmux resize-pane -D 15
# Send 'nvim .' to the top pane (pane 0)
tmux select-pane -t 0
tmux send-keys 'nvim .' C-m
# Attach to session!
tmux attach-session -t "$SESSION_NAME" 
