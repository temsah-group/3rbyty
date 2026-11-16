#!/bin/bash
# Fine-tunes Tesseract's Arabic model on card text, starting from its own
# weights, with the added digits; then makes the small integer model the
# browser uses and scores it on the evaluation pages.
cd ~/cardtrain
mkdir -p out
OMP_THREAD_LIMIT=8 lstmtraining \
  --continue_from base/ara.lstm \
  --old_traineddata base/ara.traineddata \
  --traineddata starter/ara/ara.traineddata \
  --model_output out/card \
  --train_listfile list.train \
  --eval_listfile list.eval \
  --max_iterations 6000 \
  --target_error_rate 0.005 \
  --debug_interval 0 > out/train.log 2>&1
echo "training finished"
best=$(ls -t out/card_*.checkpoint 2>/dev/null | head -1)
[ -f out/card_checkpoint ] && best=out/card_checkpoint
lstmtraining --stop_training --continue_from "$best" --traineddata starter/ara/ara.traineddata --model_output out/ara-card.traineddata >> out/train.log 2>&1
lstmtraining --stop_training --convert_to_int --continue_from "$best" --traineddata starter/ara/ara.traineddata --model_output out/ara-card-int.traineddata >> out/train.log 2>&1
ls -la out/*.traineddata
lstmeval --model out/ara-card.traineddata --eval_listfile list.eval 2>&1 | grep -E "BCER" | tail -1
