export interface SpeciesRef {
  common_name_ru: string;
  scientific_name: string | string[];
}

export type HarvestStatus = "present" | "absent";
export type Maturity = "fresh" | "mostly_fresh" | "mostly_old" | "mixed";
export type Abundance = 1 | 2 | 3 | 4 | 5;
export type WormDamage = 0 | 1 | 2 | 3;

export interface RowState {
  id: string;
  speciesIndex: number;
  status: HarvestStatus;
  abundance: Abundance;
  maturity: Maturity;
  wormDamage: WormDamage;
  comment: string;
}

export interface RegionInfo {
  country: string;
  name: string;
}

export interface LocationState {
  latitude: number;
  longitude: number;
  elevation: number | null;
  region: RegionInfo | null;
  regionPending?: boolean;
}

export interface FormState {
  location: LocationState | null;
  date: string;
  email: string;
  generalComment: string;
  rows: RowState[];
}

export interface FormErrors {
  location?: string;
  date?: string;
  rows?: string;
  rowIssues?: Record<string, string>;
  email?: string;
}

export interface PlaceResult {
  id: string;
  label: string;
  lat: number;
  lon: number;
  type?: string;
}
