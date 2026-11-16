#!/bin/bash
# The chosen checkpoint as the small integer model the browser loads, gzipped
# like the stock one, in the site's ocr-model folder.
set -e
cd ~/cardtrain
CK=out/card_4.528_3821_25300.checkpoint
lstmtraining --stop_training --convert_to_int --continue_from "$CK" --traineddata starter/ara/ara.traineddata --model_output out/ara-final-int.traineddata >/dev/null 2>&1
lstmtraining --stop_training --continue_from "$CK" --traineddata starter/ara/ara.traineddata --model_output out/ara-final.traineddata >/dev/null 2>&1
echo "float: $(lstmeval --model out/ara-final.traineddata --eval_listfile list.eval 2>&1 | grep -oE 'BCER eval=[0-9.]+, BWER eval=[0-9.]+' | tail -1)"
echo "int:   $(lstmeval --model out/ara-final-int.traineddata --eval_listfile list.eval 2>&1 | grep -oE 'BCER eval=[0-9.]+, BWER eval=[0-9.]+' | tail -1)"
OUT=/mnt/c/Users/pc/Desktop/projects/3arabity/front/ocr-model
mkdir -p "$OUT"
gzip -9 -c out/ara-final-int.traineddata > "$OUT/ara.traineddata.gz"
ls -la out/ara-final-int.traineddata "$OUT/ara.traineddata.gz"
