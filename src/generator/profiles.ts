import type { Difficulty } from "../core/model";

export interface DifficultyProfile {
  divisionsPerBeat: number;
  tripletDivisionsPerBeat: number | null;
  minGapBeats: number;
  minSameHandGapBeats: number;
  notesPerSecondAtFullEnergy: number;
  doubleChance: number;
  restResetBeats: number;
  wallsInRests: boolean;
  dodgeWallsPerBar: number;
  bombsInRests: boolean;
}

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  Easy: {
    divisionsPerBeat: 2,
    tripletDivisionsPerBeat: null,
    minGapBeats: 0.5,
    minSameHandGapBeats: 2,
    notesPerSecondAtFullEnergy: 2.2,
    doubleChance: 0.25,
    restResetBeats: 6,
    wallsInRests: false,
    dodgeWallsPerBar: 0,
    bombsInRests: false,
  },
  Normal: {
    divisionsPerBeat: 2,
    tripletDivisionsPerBeat: null,
    minGapBeats: 0.5,
    minSameHandGapBeats: 1,
    notesPerSecondAtFullEnergy: 2.7,
    doubleChance: 0.2,
    restResetBeats: 4,
    wallsInRests: true,
    dodgeWallsPerBar: 0,
    bombsInRests: false,
  },
  Hard: {
    divisionsPerBeat: 2,
    tripletDivisionsPerBeat: 3,
    minGapBeats: 0.5,
    minSameHandGapBeats: 0.75,
    notesPerSecondAtFullEnergy: 4.1,
    doubleChance: 0.32,
    restResetBeats: 3,
    wallsInRests: true,
    dodgeWallsPerBar: 0.06,
    bombsInRests: true,
  },
  Expert: {
    divisionsPerBeat: 4,
    tripletDivisionsPerBeat: 3,
    minGapBeats: 0.25,
    minSameHandGapBeats: 0.5,
    notesPerSecondAtFullEnergy: 4.7,
    doubleChance: 0.36,
    restResetBeats: 2,
    wallsInRests: true,
    dodgeWallsPerBar: 0.12,
    bombsInRests: true,
  },
};
