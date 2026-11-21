// Solara Bay — tuning constants and palette for the whole game.
// One place for every number the other modules share, so a tweak here
// retunes the city, the cars, the police and the missions together.
export const WORLD_W = 3700;
export const WORLD_H = 3700;

// City grid: 9 roads each way, 100 wide, blocks of 350 between them.
export const ROAD_W = 100;
export const BLOCK = 350;
export const ROAD_PITCH = ROAD_W + BLOCK; // 450
export const ROAD_COUNT = 9;
export const roadCenter = (i) => ROAD_W / 2 + i * ROAD_PITCH; // 50, 500, ..., 3650

// The south strip is the coast: sand, then open ocean.
export const SAND_TOP = 3300;
export const OCEAN_TOP = 3520;

// Marina Plaza, the big public square with the fountain, sits on block (4, 3).
export const PLAZA_COL = 4;
export const PLAZA_ROW = 3;

// Player on foot.
export const WALK_SPEED = 240;
export const PLAYER_RADIUS = 14;
export const PLAYER_HEALTH = 100;

// Cars.
export const CAR_LENGTH = 46;
export const CAR_WIDTH = 22;
export const TRAFFIC_COUNT = 26;
export const PARKED_COUNT = 18;
export const PED_COUNT = 34;

// Wanted level.
export const MAX_WANTED = 5;
export const WANTED_DECAY_SECONDS = 25;

// Missions pay a base amount, grown by 25% every completed round.
export const MISSION_ROUND_BONUS = 0.25;
export const CASH_PICKUP_VALUE = 25;

// Fixed simulation step, so a seeded run is the same frame every time.
export const STEP = 1 / 60;

// Sun-soaked coastal palette: warm asphalt, pale sidewalks, turquoise water.
export const PALETTE = {
  grass: '#7fae5a',
  grassDark: '#74a24f',
  park: '#69a84f',
  sidewalk: '#cfc8b8',
  asphalt: '#3d3a38',
  asphaltLight: '#454140',
  lane: '#e8d44d',
  curb: '#b7ad97',
  building: ['#e8b04b', '#d97b4f', '#7fb3d5', '#c96f6f', '#9db98a', '#b08cc9', '#e3d7c3', '#5f8f7b'],
  roof: ['#8a5a3b', '#5a6b7a', '#7a4a4a', '#4a6b5a', '#6b5a7a'],
  sand: '#e8d49a',
  ocean: '#2e8fa8',
  oceanDeep: '#1f6f8a',
  waterLine: '#bfe8ef',
  plaza: '#d8cdb4',
  fountain: '#4fb3d9',
  fountainDeep: '#2e8fa8',
  car: ['#d94f3d', '#3d7fd9', '#e8c53d', '#7ad94f', '#d97fb0', '#f2f2f2', '#2b2b2b', '#e87f2e'],
  police: '#f2f2f2',
  taxi: '#f2c230',
  hud: '#101418',
  accent: '#ffb400',
  money: '#7de07d',
  danger: '#ff5252',
};

// Camera and view.
export const VIEW_W = 1280;
export const VIEW_H = 720;
export const CAMERA_ZOOM = 1.0;
