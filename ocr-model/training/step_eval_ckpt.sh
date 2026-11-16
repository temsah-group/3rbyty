#!/bin/bash
# Scores checkpoints on the evaluation pages.
cd ~/cardtrain
for ck in "$@"; do
  lstmtraining --stop_training --continue_from "$ck" --traineddata starter/ara/ara.traineddata --model_output /tmp/ck.traineddata >/dev/null 2>&1
  echo "$(basename "$ck"): $(lstmeval --model /tmp/ck.traineddata --eval_listfile list.eval 2>&1 | grep -oE 'BCER eval=[0-9.]+, BWER eval=[0-9.]+' | tail -1)"
done
