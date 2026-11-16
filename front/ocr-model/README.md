# Card reader model (experiment — not used by the site)

`ara.traineddata.gz` is Tesseract's accurate Arabic model (`tessdata_best/ara`)
fine-tuned on text from car-parts shops' business cards, with the
Arabic-Indic digits **٢–٩ added** (the stock model only has ٠ and ١, so it
cannot read a number written ٠١٠…). It is **not served**: the site uses the
stock model (`@tesseract.js-data/ara` best_int, see `ocrAssets` in
`vite.config.ts`).

## Why it is not used

Measured on the same 48 test cards (phone-photo-like, 10 Arabic fonts), with
the rest of the reader unchanged:

| | stock model | this model |
|---|---|---|
| shop name exact | 69% | 75% |
| shop name similarity | 0.90 | 0.87 |
| mobile | 79% | 85% (reads Arabic-Indic digits on 3 of 9 cards) |
| wrong mobile | 0 | 1 |
| governorate | 98% | 94% |
| wrong governorate | 0 | 2 |
| address | 98% | 92% |

Better on exact names and on numbers, worse on addresses, and it brings back
wrong numbers and governorates, which the reader is built to avoid. On
Tesseract's own evaluation pages it is slightly better (6.1% wrong characters,
8.2% wrong words, against 6.2% and 9.1%).

## Ideas for a next round

- Use it only to read again, digits only, the lines the stock model sees with
  Arabic-Indic digits, keeping the stock model for everything else.
- Train on lines cut from real photos of shop cards, not only rendered text.

## How it was made

`training/` holds the scripts, run in WSL Ubuntu with `tesseract-ocr` 5.5
(`lstmtraining`, `text2image`) and the Windows Arabic fonts copied to
`~/.fonts`:

1. `gen_text.py`: shop names, addresses, taglines and phone numbers (both digit
   styles), never the test cards' names. `step_text.sh` makes train/eval text.
2. `step_render.sh` / `step_round2.sh`: the text rendered in 23 Arabic fonts,
   with noise, tilt and exposure, into `.lstmf` files (about 24,000 lines).
3. `step_starter.sh`: the stock model's character set merged with the
   training text's (adding ٢–٩), its dictionary kept.
4. `step_train.sh`, then `step_round2.sh`: `lstmtraining` continued from
   `tessdata_best/ara` up to 30,000 lines.
5. `step_eval_ckpt.sh` picks the checkpoint by the evaluation pages;
   `step_export.sh` makes this small integer model.

To try it in the site: serve it in `ocrAssets` under a new folder, point
`langPath` in `src/lib/card-ocr.ts` there and give `cachePath` a new name.
