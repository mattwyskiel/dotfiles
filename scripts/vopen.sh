#!/bin/bash

# Usage: workdir /path/to/dir

# Get the target directory, default to $HOME if not provided
DIR="${1:-$HOME}"
# Get the desired session name, if not provided, default to the current directory name
SESSION_NAME="${2:-$(basename "$DIR")}"
# Check if the session already exists
# If it does, attach to it
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Session $SESSION_NAME already exists. Attaching..."
    tmux attach-session -t "$SESSION_NAME"
    exit 0
fi
tmux new-session -d -c "$DIR" -s "$SESSION_NAME" # start detached session in DIR
tmux new-window -dnterminal -c "$DIR" # create new window for editor
tmux send-keys 'nvim .' C-m
# Attach to session!
tmux attach-session -t "$SESSION_NAME" 
