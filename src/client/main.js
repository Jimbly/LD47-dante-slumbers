/*eslint global-require:off*/
const glov_local_storage = require('./glov/local_storage.js');
glov_local_storage.storage_prefix = 'ld47'; // Before requiring anything else that might load from this

const camera2d = require('./glov/camera2d.js');
const engine = require('./glov/engine.js');
const glov_font = require('./glov/font.js');
const input = require('./glov/input.js');
const { cos, floor, max, min, sin, tan, PI } = Math;
const net = require('./glov/net.js');
const pico8 = require('./glov/pico8.js');
const { randCreate } = require('./glov/rand_alea.js');
const glov_sprites = require('./glov/sprites.js');
// const sprite_animation = require('./glov/sprite_animation.js');
// const transition = require('./glov/transition.js');
const ui = require('./glov/ui.js');
const { clamp } = require('../common/util.js');
// const { soundLoad, soundPlay, soundPlayMusic, FADE_IN, FADE_OUT } = require('./glov/sound.js');
const {
  vec2,
  v2add,
  v2distSq,
  v2scale,
  v2sub,
  vec4,
} = require('./glov/vmath.js');

window.Z = window.Z || {};
Z.BACKGROUND = 1;
Z.AIR = 10;
Z.PLAYER = 20;
Z.ROCKS = 30;
Z.RINGS = 32;
Z.PLAYER_WIN = 40;
Z.PARTICLES = 20;
Z.UI_play = 200;

// let app = exports;
// Virtual viewport for our game logic
const game_width = 320;
const game_height = 240;
const render_width = game_width;
const render_height = game_height;

const rock_fade_time = 1000;

export let sprites = {};

export function main() {
  if (engine.DEBUG) {
    // Enable auto-reload, etc
    net.init({ engine });
  }

  function startup() {
    const font_info_04b03x2 = require('./img/font/04b03_8x2.json');
    const font_info_04b03x1 = require('./img/font/04b03_8x1.json');
    const font_info_palanquin32 = require('./img/font/palanquin32.json');
    let pixely = 'strict';
    let font;
    let title_font;
    if (pixely === 'strict') {
      font = { info: font_info_04b03x1, texture: 'font/04b03_8x1' };
      title_font = { info: font_info_04b03x2, texture: 'font/04b03_8x2' };
    } else if (pixely && pixely !== 'off') {
      font = { info: font_info_04b03x2, texture: 'font/04b03_8x2' };
    } else {
      font = { info: font_info_palanquin32, texture: 'font/palanquin32' };
    }

    if (!engine.startup({
      game_width: render_width,
      game_height: render_height,
      pixely,
      font,
      title_font,
      viewport_postprocess: false,
    })) {
      return true;
    }
    return false;
  }
  if (startup()) {
    return;
  }

  let { font, title_font } = ui;

  // const font = engine.font;

  // Perfect sizes for pixely modes
  ui.scaleSizes(13 / 32);
  ui.setFontHeight(8);

  const createSprite = glov_sprites.create;
  // const createAnimation = sprite_animation.create;

  const KEYS = input.KEYS;
  //const PAD = input.PAD;

  function initGraphics() {
    sprites.rock = createSprite({
      name: 'rock',
      size: vec2(16, 16),
      origin: vec2(0.5,0.5),
    });
    sprites.player = createSprite({
      name: 'plane',
      size: vec2(16, 16),
      origin: vec2(0.5,0.5),
    });
    sprites.ring = createSprite({
      name: 'ring',
      ws: [32, 32, 32],
      hs: [32, 32, 32, 32],
      size: vec2(16, 16),
      origin: vec2(0.5, 0.5),
    });
    sprites.air = createSprite({
      url: 'white',
      size: vec2(1, 1),
      origin: vec2(0.5, 0.5),
    });
    sprites.game_bg = createSprite({
      url: 'white',
      size: vec2(render_width, render_height),
    });
  }
  initGraphics();

  const base_radius = 50;
  let state;
  let rand;
  function setupLevel(seed) {
    rand = randCreate(seed);
    let rdense = 16;
    let safe_zone = 320;
    let num_rings = 2;
    let ring_dense = 160;
    let air_dense = 230;
    let level_w = ring_dense * (num_rings + 1);
    state = {
      num_rings,
      level_w,
      hit_rings: 0,
      hit_rocks: 0,
      cam_x: -game_width / 2 + 160,
      player: {
        pos: vec2(160, game_height / 2 + base_radius),
        angle: PI,
        radius: 1,
      },
      stuff: [],
    };
    let num_rocks = floor(state.level_w / rdense);
    for (let ii = 0; ii < num_rocks; ++ii) {
      let x = (ii + rand.random()) * rdense;
      let y = rand.floatBetween(16, game_height - 16*2);
      if (x < safe_zone) {
        y = y < game_height / 2 ? y * 0.1 : game_height - (game_height - y) * 0.1;
      }
      state.stuff.push({
        sprite: sprites.rock,
        type: 'rock',
        pos: vec2(x, y),
        angle: rand.floatBetween(0, PI * 2),
        rspeed: rand.floatBetween(-1, 1),
        color: vec4(0.1, 0.1, 0.1, 1),
        freq: 0, // 0.001 * rand.random(),
        amp: 40,
        rsquared: 8*8,
        z: Z.ROCKS,
      });
    }
    for (let ii = 0; ii < num_rings; ++ii) {
      state.stuff.push({
        sprite: sprites.ring,
        type: 'ring',
        pos: vec2((ii + 1 + rand.random()) * ring_dense, rand.floatBetween(32, game_height - 32*2)),
        angle: 0,
        rspeed: 0,
        frame: rand.floatBetween(0, 10),
        color: vec4(1,1,1, 1),
        rsquared: 12*12,
        freq: 0.001,
        amp: 32,
        z: Z.RINGS,
      });
    }
    let num_air = air_dense ? floor(level_w / air_dense) : 0;
    for (let ii = 0; ii < num_air; ++ii) {
      state.stuff.push({
        sprite: sprites.air,
        type: 'air',
        pos: vec2((ii + rand.random()) * air_dense, rand.floatBetween(16, game_height - 16)),
        size: vec2(32, rand.floatBetween(32, 64)),
        angle: 0,
        rspeed: 0,
        color: pico8.colors[12],
        rsquared: 12*12,
        freq: 0,
        amp: 32,
        z: Z.AIR,
      });
    }
    for (let ii = 0; ii < state.stuff.length; ++ii) {
      state.stuff[ii].pos0 = state.stuff[ii].pos.slice(0);
    }
  }
  setupLevel(4);

  let hud_style = glov_font.style(null, {
    outline_width: 3,
    outline_color: (pico8.font_colors[0] & 0xFFFFFF00) | 0x80,
    color: pico8.font_colors[9],
  });

  let hits_style_green = glov_font.style(null, {
    outline_width: 3,
    outline_color: pico8.font_colors[0],
    color: pico8.font_colors[11],
  });
  let hits_style_yellow = glov_font.style(hits_style_green, {
    color: pico8.font_colors[10],
  });
  let hits_style_red = glov_font.style(hits_style_green, {
    color: pico8.font_colors[8],
  });

  const speed_scale = 0.75;
  const dTheta = 0.002 * speed_scale;
  const accel = 0.0025;
  const air_drag = 0.5;
  const min_radius = 0.5 * base_radius;
  let delta = vec2();
  function play(dt) {
    sprites.game_bg.draw({
      x: 0, y: 0, z: Z.BACKGROUND,
      color: pico8.colors[1],
    });
    camera2d.setAspectFixed(game_width, game_height);

    let { player, stuff } = state;
    if (player.pos[0] > state.level_w) {
      player.pos[0] -= state.level_w;
      state.cam_x -= state.level_w;
    } else if (player.pos[0] < 0) {
      player.pos[0] += state.level_w;
      state.cam_x += state.level_w;
    }

    // update stuff
    let hit_air = false;
    for (let ii = 0; ii < stuff.length; ++ii) {
      let r = stuff[ii];
      r.angle += r.rspeed * dt * 0.0002;
      r.pos[1] = r.pos0[1] + r.amp * sin(r.freq * engine.frame_timestamp);
      if (r.type === 'air') {
        r.hit = player.pos[0] > r.pos[0] - r.size[0]/2 && player.pos[0] < r.pos[0] + r.size[0]/2 &&
          player.pos[1] > r.pos[1] - r.size[1]/2 && player.pos[1] < r.pos[1] + r.size[1]/2;
        if (r.hit) {
          hit_air = true;
        }
      }
    }

    // update player
    let new_pos;
    let player_scale = 1;
    if (state.do_win) {
      state.win_counter += dt;
      // Even out angle
      let da = dt * dTheta * 1.5;
      if (player.angle < PI && player.angle > PI * 0.75) {
        player.angle = min(player.angle + da, PI);
      } else {
        player.angle -= da;
        if (player.angle < 0) {
          player.angle += PI * 2;
        }
        if (player.angle < PI && player.angle > PI * 0.75) {
          player.angle = PI;
        }
      }
      let dist = -dt * speed_scale * 0.2;
      new_pos = vec2(player.pos[0] + cos(player.angle) * dist, player.pos[1] + sin(player.angle) * dist);
      if (player.angle === PI) {
        let dh = dt * 0.1;
        // if (new_pos[1] < game_height/2) {
        //   new_pos[1] = min(new_pos[1] + dh, game_height / 2);
        // } else if (new_pos[1] > game_height / 2) {
        //   new_pos[1] = max(new_pos[1] - dh, game_height / 2);
        // }
        new_pos[1] -= dh;
      }
      player_scale = min(1 + state.win_counter * 0.0005, 2);
    } else {
      let { radius } = player;
      if (input.keyDown(KEYS.D)) {
        player.radius = min(2, radius + dt * accel);
      } else if (input.keyDown(KEYS.A)) {
        player.radius = max(0.5, radius - dt * accel);
      } else if (radius > 1) {
        player.radius = max(1, radius - dt * accel * 2);
      } else if (radius < 1) {
        player.radius = min(1, radius + dt * accel * 2);
      }
      radius = player.radius * base_radius;
      let { angle } = player;
      // Test angle against the top of the screen (y = 0)
      let test_angle = angle;
      let rbias = 0;
      if (test_angle > PI) {
        // coming down from the top, scale back the max radius limit
        test_angle = PI * 2 - test_angle;
        if (test_angle < PI / 2) {
          rbias = test_angle * base_radius * 2;
        } else {
          rbias = (PI - test_angle) * base_radius * 2;
        }
      }
      let dist_to_top = player.pos[1];
      let inter_angle = (PI - test_angle) / 2;
      let hoffs = tan(inter_angle) * dist_to_top;
      let max_r = hoffs / sin(PI - test_angle) - 0.5 + rbias;
      //let maxs_center = vec2(player.pos[0] + max_r * cos(angle + PI/2), player.pos[1] + max_r * sin(angle + PI/2));
      //ui.drawHollowCircle(maxs_center[0], maxs_center[1], Z.PLAYER - 1, max_r, 0.99, [1,1,1, 0.5]);

      // Test angle against the bottom of the screen (y = 0)
      test_angle = angle - PI;
      if (test_angle < 0) {
        test_angle += PI * 2;
      }
      rbias = 0;
      if (test_angle > PI) {
        test_angle = PI * 2 - test_angle;
        if (test_angle < PI / 2) {
          rbias = test_angle * base_radius * 2;
        } else {
          rbias = (PI - test_angle) * base_radius * 2;
        }
      }
      let dist_to_bottom = game_height - player.pos[1];
      inter_angle = (PI - test_angle) / 2;
      hoffs = tan(inter_angle) * dist_to_bottom;
      let max_r2 = hoffs / sin(PI - test_angle) - 0.5 + rbias;
      // let maxs_center = vec2(player.pos[0] + max_r2 * cos(angle + PI/2), player.pos[1] + max_r2 * sin(angle + PI/2));
      // ui.drawHollowCircle(maxs_center[0], maxs_center[1], Z.PLAYER - 1, max_r2, 0.99, [1,1,1, 0.5]);

      // ui.print(null, 50, 50, Z.PLAYER + 10, `angle: ${(angle * 180 / PI).toFixed(0)}`);
      if (isFinite(max_r2)) {
        if (isFinite(max_r)) {
          max_r = min(max_r, max_r2);
        } else {
          max_r = max_r2;
        }
      }
      if (isFinite(max_r)) {
        // let maxs_center = vec2(player.pos[0] + max_r * cos(angle + PI/2), player.pos[1] + max_r * sin(angle + PI/2));
        // ui.drawHollowCircle(maxs_center[0], maxs_center[1], Z.PLAYER - 1, max_r, 0.99, [1,0,0, 0.5]);
        // Instead of an absolute max, we want to reduce the radius only if
        //  the *minimum* radius is not going to fit?
        if (max_r > min_radius) {
          max_r = (max_r - min_radius) * 4 + min_radius;
        }
        // maxs_center = vec2(player.pos[0] + max_r * cos(angle + PI/2), player.pos[1] + max_r * sin(angle + PI/2));
        // ui.drawHollowCircle(maxs_center[0], maxs_center[1], Z.PLAYER - 1, max_r, 0.99, [0,1,0, 0.5]);
        radius = min(radius, max_r);
      }
      // let dir = vec2(cos(angle), sin(angle));
      let new_angle = angle - dt * dTheta;
      if (new_angle < 0) {
        new_angle += PI * 2;
      }
      let center = vec2(player.pos[0] + radius * cos(angle + PI/2), player.pos[1] + radius * sin(angle + PI/2));
      new_pos = vec2(center[0] - radius * cos(new_angle + PI/2), center[1] - radius * sin(new_angle + PI/2));
      if (hit_air) {
        // This is effectively no different than scaling the radius!
        v2sub(delta, new_pos, player.pos);
        v2scale(delta, delta, air_drag);
        v2add(new_pos, player.pos, delta);
      }
      player.angle = new_angle;
    }
    if (!state.do_win) {
      new_pos[1] = clamp(new_pos[1], 0, game_height);
    }
    player.pos[0] = new_pos[0];
    player.pos[1] = new_pos[1];
    state.cam_x = min(max(state.cam_x, floor(player.pos[0]) - game_width * 2 / 3),
      floor(player.pos[0]) - game_width / 3);

    let cam_x = floor(state.cam_x);
    camera2d.set(camera2d.x0() + cam_x, camera2d.y0(), camera2d.x1() + cam_x, camera2d.y1());

    sprites.player.draw({
      x: floor(player.pos[0]),
      y: floor(player.pos[1]),
      z: state.do_win ? Z.PLAYER_WIN : Z.PLAYER,
      rot: player.angle + PI,
      color: [1, 1, 1, 1],
      w: player_scale,
      h: player_scale,
    });
    let view_x0 = cam_x - 64;
    let view_x1 = cam_x + game_width + 64;
    for (let ii = 0; ii < stuff.length; ++ii) {
      let r = stuff[ii];
      if (r.hide) {
        continue;
      }
      let frame;
      let hit = false;
      let w;
      let h;
      if (r.type === 'air') {
        w = r.size[0];
        h = r.size[1];
        if (r.hit) {
          r.color[3] = 1;
        } else {
          r.color[3] = 0.5;
        }
      } else {
        hit = v2distSq(r.pos, player.pos) < r.rsquared && !state.do_win;
        if (hit) {
          if (!r.hit) {
            r.hit = true;
            r.hit_fade = rock_fade_time;
            if (r.type === 'rock') {
              state.hit_rocks++;
              state.player.radius = 0.5;
              state.player.angle += rand.floatBetween(0.5, 0.75);
            } else if (r.type === 'ring') {
              state.hit_rings++;
              if (state.hit_rings === state.num_rings) {
                state.do_win = true;
                state.win_counter = 0;
              }
            }
          }
          if (r.type === 'rock') {
            r.color[0] = 1;
          } else {
            r.color[0] = 0;
            r.color[2] = 0;
          }
        }
        if (r.hit) {
          r.hit_fade -= dt;
          if (r.hit_fade < 0) {
            r.hide = true;
            continue;
          }
          r.color[3] = r.hit_fade / rock_fade_time;
        }
        if (r.type === 'ring') {
          frame = floor(r.frame + engine.frame_timestamp * 0.01) % 10;
        }
      }
      let x = r.pos[0];
      if (x > view_x1) {
        x -= state.level_w;
      } else if (x < view_x0) {
        x += state.level_w;
      }
      if (x >= view_x0 && x <= view_x1) {
        r.sprite.draw({
          x,
          y: r.pos[1],
          z: r.z,
          w, h,
          rot: r.angle,
          color: r.color,
          frame,
        });
      }
    }

    ui.print(null, 50 + (cam_x > game_width/2 ? state.level_w : 0), game_height - 32,
      Z.PLAYER - 1, 'Controls: A and D');

    // HUD
    camera2d.setAspectFixed(game_width, game_height);

    //ui.print(null, 5, 5, Z.UI, `cam_x:${cam_x}`);

    let score_size = 100;
    title_font.drawSizedAligned(hud_style, game_width - score_size, game_height - 16, Z.UI, 26,
      font.ALIGN.HCENTER|font.ALIGN.VBOTTOM, score_size, 0, `${state.hit_rings}/${state.num_rings}`);
    font.drawSizedAligned(
      !state.hit_rocks ? hits_style_green : state.hit_rocks < 3 ? hits_style_yellow : hits_style_red,
      game_width - score_size, game_height - 4, Z.UI, ui.font_height,
      font.ALIGN.HCENTER|font.ALIGN.VBOTTOM, score_size, 0, `${state.hit_rocks} hits`);
  }

  function playInit(dt) {
    engine.setState(play);
    play(dt);
  }

  engine.setState(playInit);
}
