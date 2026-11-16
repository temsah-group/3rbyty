#!/bin/bash
# Training and evaluation text, and a check that every character is one the model knows.
set -e
S=/mnt/c/Users/pc/AppData/Local/Temp/claude/e4025561dcea89ea/56c5af52-80ae-49ef-b0cf-25f75be47071/scratchpad
mkdir -p ~/cardtrain/text && cd ~/cardtrain/text
python3 "$S/gen_text.py" 6000 1 > train.txt
python3 "$S/gen_text.py" 400 777 > eval.txt
wc -l train.txt eval.txt
head -6 train.txt
python3 - <<'EOF'
import io, os
chars = set(io.open('train.txt', encoding='utf-8').read()) | set(io.open('eval.txt', encoding='utf-8').read())
uni = set(l.split(' ')[0] for l in io.open(os.path.expanduser('~/cardtrain/base/ara.lstm-unicharset'), encoding='utf-8').read().splitlines()[1:])
print('missing from the model charset:', sorted(c for c in chars if c not in uni and c not in ' \n'))
EOF
