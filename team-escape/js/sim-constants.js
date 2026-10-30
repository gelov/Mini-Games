// Physics constants shared by the level builder, the server sim and the client.
export const PHYS = {
  G: 1800, // gravity, px/s^2
  JUMP_V: 680, // take-off speed -> ~117px apex at 30Hz
  SPEED: 220, // run speed, px/s
  PUSH_SPEED: 90, // crate speed while enough players push
  MAX_FALL: 900,
  PW: 26, // player width
  PH: 34, // player height
  DT: 1 / 30, // server tick
};
