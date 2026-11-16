#!/bin/bash
# A starter model: Tesseract's Arabic one, with the characters it lacks
# (the Arabic-Indic digits ٢-٩) added, keeping its word lists.
set -e
cd ~/cardtrain
mkdir -p langdata starter
cd langdata
for f in radical-stroke.txt Arabic.unicharset Latin.unicharset; do
  [ -s "$f" ] || curl -sSLf -o "$f" "https://raw.githubusercontent.com/tesseract-ocr/langdata_lstm/main/$f"
done
ls -la
cd ~/cardtrain
# The model's own word lists back out of its dictionaries.
dawg2wordlist base/ara.lstm-unicharset base/ara.lstm-word-dawg starter/ara.wordlist 2>/dev/null || true
dawg2wordlist base/ara.lstm-unicharset base/ara.lstm-number-dawg starter/ara.numbers 2>/dev/null || true
dawg2wordlist base/ara.lstm-unicharset base/ara.lstm-punc-dawg starter/ara.punc 2>/dev/null || true
wc -l starter/ara.wordlist starter/ara.numbers starter/ara.punc
# The card words join the word list, so the dictionary knows them too.
tr ' ' '\n' < text/train.txt | grep -P '^\p{Arabic}{2,}$' | sort -u > /tmp/cardwords.txt
sort -u starter/ara.wordlist /tmp/cardwords.txt > starter/ara.words.all
# Characters of the training text merged into the model's own set.
unicharset_extractor --output_unicharset starter/text.unicharset --norm_mode 2 text/train.txt text/eval.txt >/dev/null
merge_unicharsets base/ara.lstm-unicharset starter/text.unicharset starter/ara.unicharset >/dev/null
echo "chars: $(head -1 base/ara.lstm-unicharset) -> $(head -1 starter/ara.unicharset)"
combine_lang_model --input_unicharset starter/ara.unicharset --script_dir langdata --lang ara --output_dir starter \
  --words starter/ara.words.all --numbers starter/ara.numbers --puncs starter/ara.punc --lang_is_rtl --pass_through_recoder 2>&1 | tail -3
ls -la starter/ara/
