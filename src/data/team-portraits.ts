import sonnyGulf from "@/assets/team/sonny-gulf.jpg";
import evaGulf from "@/assets/team/eva-gulf.jpg";
import samGulf from "@/assets/team/sam-gulf.jpg";
import nourGulf from "@/assets/team/nour-gulf.jpg";
import danaGulf from "@/assets/team/dana-gulf.jpg";
import adamGulf from "@/assets/team/adam-gulf.jpg";

import sonnyEg from "@/assets/team/sonny-eg.jpg";
import evaEg from "@/assets/team/eva-eg.jpg";
import samEg from "@/assets/team/sam-eg.jpg";
import nourEg from "@/assets/team/nour-eg.jpg";
import danaEg from "@/assets/team/dana-eg.jpg";
import adamEg from "@/assets/team/adam-eg.jpg";

import sonnySham from "@/assets/team/sonny-sham.jpg";
import evaSham from "@/assets/team/eva-sham.jpg";
import samSham from "@/assets/team/sam-sham.jpg";
import nourSham from "@/assets/team/nour-sham.jpg";
import danaSham from "@/assets/team/dana-sham.jpg";
import adamSham from "@/assets/team/adam-sham.jpg";

import sonnyMaghreb from "@/assets/team/sonny-maghreb.jpg";
import evaMaghreb from "@/assets/team/eva-maghreb.jpg";
import samMaghreb from "@/assets/team/sam-maghreb.jpg";
import nourMaghreb from "@/assets/team/nour-maghreb.jpg";
import danaMaghreb from "@/assets/team/dana-maghreb.jpg";
import adamMaghreb from "@/assets/team/adam-maghreb.jpg";

/** الأزياء الإقليمية المتاحة لصور الفريق. */
export const REGIONS = ["gulf", "eg", "sham", "maghreb"] as const;
export type Region = (typeof REGIONS)[number];

export const REGION_LABELS: Record<Region, string> = {
  gulf: "الخليج",
  eg: "مصر",
  sham: "الشام",
  maghreb: "المغرب العربي",
};

export const REGION_FLAGS: Record<Region, string> = {
  gulf: "🇸🇦",
  eg: "🇪🇬",
  sham: "🇯🇴",
  maghreb: "🇲🇦",
};

const portraits: Record<Region, Record<string, string>> = {
  gulf: {
    sonny: sonnyGulf,
    eva: evaGulf,
    sam: samGulf,
    nour: nourGulf,
    dana: danaGulf,
    adam: adamGulf,
  },
  eg: { sonny: sonnyEg, eva: evaEg, sam: samEg, nour: nourEg, dana: danaEg, adam: adamEg },
  sham: {
    sonny: sonnySham,
    eva: evaSham,
    sam: samSham,
    nour: nourSham,
    dana: danaSham,
    adam: adamSham,
  },
  maghreb: {
    sonny: sonnyMaghreb,
    eva: evaMaghreb,
    sam: samMaghreb,
    nour: nourMaghreb,
    dana: danaMaghreb,
    adam: adamMaghreb,
  },
};

export function portraitOf(memberId: string, region: Region): string {
  return portraits[region][memberId] ?? portraits.gulf[memberId] ?? sonnyGulf;
}
