import type { Difficulty } from "../core/model";

export interface DifficultyProfile {
  divisionsPerBeat: number;
  minGapBeats: number;
  minSameHandGapBeats: number;
  notesPerSecondAtFullEnergy: number;
  doubleChance: number;
  dotChance: number;
  angledChance: number;
  restResetBeats: number;
  wallsInRests: boolean;
  dodgeWallsPerBar: number;
  bombsInRests: boolean;
}

export const DIFFICULTY_PROFILES: Record<Difficulty, DifficultyProfile> = {
  Easy: {
    divisionsPerBeat: 1,
    minGapBeats: 1,
    minSameHandGapBeats: 2,
    notesPerSecondAtFullEnergy: 1.1,
    doubleChance: 0,
    dotChance: 0.2,
    angledChance: 0.1,
    restResetBeats: 6,
    wallsInRests: false,
    dodgeWallsPerBar: 0,
    bombsInRests: false,
  },
  Normal: {
    divisionsPerBeat: 2,
    minGapBeats: 0.5,
    minSameHandGapBeats: 1,
    notesPerSecondAtFullEnergy: 1.9,
    doubleChance: 0.05,
    dotChance: 0.1,
    angledChance: 0.25,
    restResetBeats: 4,
    wallsInRests: true,
    dodgeWallsPerBar: 0,
    bombsInRests: false,
  },
  Hard: {
    divisionsPerBeat: 2,
    minGapBeats: 0.5,
    minSameHandGapBeats: 0.75,
    notesPerSecondAtFullEnergy: 2.9,
    doubleChance: 0.12,
    dotChance: 0.05,
    angledChance: 0.35,
    restResetBeats: 3,
    wallsInRests: true,
    dodgeWallsPerBar: 0.06,
    bombsInRests: true,
  },
  Expert: {
    divisionsPerBeat: 4,
    minGapBeats: 0.25,
    minSameHandGapBeats: 0.5,
    notesPerSecondAtFullEnergy: 4.3,
    doubleChance: 0.18,
    dotChance: 0.03,
    angledChance: 0.4,
    restResetBeats: 2,
    wallsInRests: true,
    dodgeWallsPerBar: 0.12,
    bombsInRests: true,
  },
};
