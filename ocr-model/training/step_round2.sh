#!/bin/bash
# Round two: more training text in two sizes, then training continued from
# round one up to 30000 lines, then the models and their score.
set -u
S=/mnt/c/Users/pc/AppData/Local/Temp/claude/e4025561dcea89ea/56c5af52-80ae-49ef-b0cf-25f75be47071/scratchpad
cd ~/cardtrain
python3 "$S/gen_text.py" 12000 2 > text/train2.txt
mkdir -p ground2
FONTS=("Tahoma" "Tahoma Bold" "Arial" "Arial Bold" "Segoe UI" "Segoe UI Bold" "Simplified Arabic" "Simplified Arabic Bold"
       "Traditional Arabic" "Traditional Arabic Bold" "Sakkal Majalla" "Sakkal Majalla Bold" "Arabic Typesetting" "Andalus" "Aldhabi"
       "Times New Roman" "Times New Roman, Bold" "Noto Naskh Arabic" "Noto Naskh Arabic Bold" "Noto Kufi Arabic" "Noto Kufi Arabic Bold"
       "Noto Sans Arabic" "Noto Sans Arabic Bold")
render() { # text font tag exposure ptsize
  local base="ground2/ara.$(echo "$2" | tr -d ' ,').$3"
  text2image --text="$1" --outputbase="$base" --font="$2" --fonts_dir="$HOME/.fonts" --ptsize="$5" --exposure="$4" \
    --char_spacing=0 --leading=32 --xsize=2550 --ysize=900 --margin=40 --rotate_image=true --degrade_image=true \
    --strip_unrenderable_words=true >/dev/null 2>&1 || { echo "render failed: $2"; return; }
  tesseract "$base.tif" "$base" --psm 6 lstm.train >/dev/null 2>&1 || echo "lstmf failed: $2"
}
per=$(( $(wc -l < text/train2.txt) / (${#FONTS[@]} * 2) ))
k=0
for size in 11 17; do
  for f in "${FONTS[@]}"; do
    sed -n "$((k * per + 1)),$(((k + 1) * per))p" text/train2.txt > "/tmp/chunk-$k.txt"
    render "/tmp/chunk-$k.txt" "$f" "s${size}e$((k % 3 - 1))" "$((k % 3 - 1))" "$size" &
    if (( (k + 1) % 8 == 0 )); then wait; fi
    k=$((k + 1))
  done
done
wait
ls ground/*.lstmf ground2/*.lstmf > list.train
echo "training files: $(wc -l < list.train)"
OMP_THREAD_LIMIT=8 lstmtraining \
  --continue_from out/card_checkpoint \
  --traineddata starter/ara/ara.traineddata \
  --model_output out/card \
  --train_listfile list.train \
  --eval_listfile list.eval \
  --max_iterations 30000 \
  --target_error_rate 0.005 \
  --debug_interval 0 > out/train2.log 2>&1
echo "round two finished"
grep -E '^At iteration' out/train2.log | tail -1
lstmtraining --stop_training --continue_from out/card_checkpoint --traineddata starter/ara/ara.traineddata --model_output out/ara-card2.traineddata >/dev/null 2>&1
echo "latest: $(lstmeval --model out/ara-card2.traineddata --eval_listfile list.eval 2>&1 | grep -oE 'BCER eval=[0-9.]+, BWER eval=[0-9.]+' | tail -1)"
