"use client";

import type { LargoCompareCard as LargoCompareCardPayload } from "@/lib/largo/helix-thermal-compare";
import type { PlaySimilarityCard } from "@/lib/largo/play-similarity";
import type { PreEarningsPackCard } from "@/lib/largo/pre-earnings-pack";
import { LargoCompareCard } from "@/features/largo/components/LargoCompareCard";
import { LargoPlaySimilarityCard } from "@/features/largo/components/LargoPlaySimilarityCard";
import { LargoPreEarningsPackCard } from "@/features/largo/components/LargoPreEarningsPackCard";

export function LargoStructuredCards({
  compareCard,
  playSimilarity,
  preEarningsPack,
}: {
  compareCard?: LargoCompareCardPayload | null;
  playSimilarity?: PlaySimilarityCard | null;
  preEarningsPack?: PreEarningsPackCard | null;
}) {
  if (!compareCard && !playSimilarity && !preEarningsPack) return null;
  return (
    <>
      {compareCard && <LargoCompareCard card={compareCard} />}
      {playSimilarity && <LargoPlaySimilarityCard card={playSimilarity} />}
      {preEarningsPack && <LargoPreEarningsPackCard card={preEarningsPack} />}
    </>
  );
}
