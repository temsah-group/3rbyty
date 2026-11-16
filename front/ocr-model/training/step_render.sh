#!/bin/bash
# Renders the training text in many Arabic fonts (each font its own lines,
# with noise, slight tilt and varied exposure) and turns each page into the
# .lstmf files lstmtraining reads.
set -u
cd ~/cardtrain
mkdir -p ground eval-ground
FONTS=("Tahoma" "Tahoma Bold" "Arial" "Arial Bold" "Segoe UI" "Segoe UI Bold" "Simplified Arabic" "Simplified Arabic Bold"
       "Traditional Arabic" "Traditional Arabic Bold" "Sakkal Majalla" "Sakkal Majalla Bold" "Arabic Typesetting" "Andalus" "Aldhabi"
       "Times New Roman" "Times New Roman, Bold" "Noto Naskh Arabic" "Noto Naskh Arabic Bold" "Noto Kufi Arabic" "Noto Kufi Arabic Bold"
       "Noto Sans Arabic" "Noto Sans Arabic Bold")
render() { # text font outdir tag exposure
  local base="$3/ara.$(echo "$2" | tr -d ' ,').$4"
  text2image --text="$1" --outputbase="$base" --font="$2" --fonts_dir="$HOME/.fonts" --ptsize=14 --exposure="$5" \
    --char_spacing=0 --leading=32 --xsize=2550 --ysize=900 --margin=40 --rotate_image=true --degrade_image=true \
    --strip_unrenderable_words=true >/dev/null 2>&1 || { echo "render failed: $2"; return; }
  tesseract "$base.tif" "$base" --psm 6 lstm.train >/dev/null 2>&1 || echo "lstmf failed: $2"
}
per=$(( $(wc -l < text/train.txt) / ${#FONTS[@]} ))
i=0
for f in "${FONTS[@]}"; do
  sed -n "$((i * per + 1)),$(((i + 1) * per))p" text/train.txt > /tmp/chunk.txt
  render /tmp/chunk.txt "$f" ground "exp$((i % 3 - 1))" "$((i % 3 - 1))" &
  # A few at a time: 12 cores.
  if (( (i + 1) % 6 == 0 )); then wait; fi
  i=$((i + 1))
done
wait
# Evaluation pages: other text, a handful of fonts.
j=0
for f in "Tahoma" "Segoe UI Bold" "Traditional Arabic" "Sakkal Majalla" "Noto Naskh Arabic" "Arial"; do
  sed -n "$((j * 66 + 1)),$(((j + 1) * 66))p" text/eval.txt > /tmp/eval-$j.txt
  render /tmp/eval-$j.txt "$f" eval-ground "eval$j" 0 &
  j=$((j + 1))
done
wait
ls ground/*.lstmf | wc -l; ls eval-ground/*.lstmf | wc -l
ls ground/*.lstmf > list.train; ls eval-ground/*.lstmf > list.eval
