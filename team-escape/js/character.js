// Team Escape player character. Two placeholder drawings live in ../assets and can be swapped for new art:
//   character.svg       front view, used while standing still (and for lobby avatars / illustrations)
//   character-walk.svg  walking pose, used while moving or in the air
// Both are loaded once, recoloured per team by swapping their body palette, and split into a body layer and
// one layer per leg so the renderer can swing the legs at the hips.

const POSES = {
  front: {
    file: '../assets/character.svg',
    w: 426.46,
    h: 388.1,
    // body colours in the art -> [Team Moss, Team Ember]; anything not listed keeps its colour
    palette: {
      '#e63271': ['#5dd9b3', '#ff8a5c'], // main
      '#ff528e': ['#9ff0d6', '#ffb38f'], // highlight
      '#bd124e': ['#33a487', '#d8613a'], // shade
      '#a31043': ['#1f7a63', '#a8431f'], // dark edge
      '#851039': ['#16594a', '#7a2e14'], // mouth
    },
    // each leg: path-data prefixes of its groups (leg + foot), the hip pivot, where the foot sits (walking art
    // only, used to swing the leg around straight-down), and the outline area the leg owns
    legs: [
      { paths: ['M197.53,377.87', 'M186.17,370.77'], hip: [197.5, 318], clip: [150, 326, 63, 70] },
      { paths: ['M228.58,377.87', 'M243.64,385.1'], hip: [228.6, 318], clip: [213, 326, 63, 70] },
    ],
    bodyClip: [[0, 0, 426.46, 326]],
  },
  walk: {
    file: '../assets/character-walk.svg',
    w: 399.03,
    h: 369.52,
    palette: {
      '#00bab7': ['#5dd9b3', '#ff8a5c'],
      '#00d4d0': ['#9ff0d6', '#ffb38f'],
      '#008096': ['#33a487', '#d8613a'],
      '#00627d': ['#1f7a63', '#a8431f'],
      '#851039': ['#16594a', '#7a2e14'],
    },
    legs: [
      { paths: ['M145.92,350.77', 'M81.5,350.37'], hip: [176, 314], foot: [95, 345], clip: [60, 318, 125, 55] }, // back leg
      { paths: ['M268.32,365.98', 'M296,346.08'], hip: [204, 322], foot: [284, 358], clip: [190, 330, 130, 42] }, // front leg
    ],
    bodyClip: [[0, 0, 399.03, 318], [185, 318, 65, 12]],
  },
};

const RASTER_W = 200; // pre-rendered width: crisp at in-game scale, cheap to draw every frame
export const CHARACTER_ASPECT = POSES.front.w / POSES.front.h;
export const ART_W = POSES.front.w; // kept for the front view's sizing
export const ART_H = POSES.front.h;

const urls = { front: [null, null], walk: [null, null] };
const layers = { front: [null, null], walk: [null, null] };
const images = [null, null];

const toUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const xml = (el) => new XMLSerializer().serializeToString(el);
const NS = 'http://www.w3.org/2000/svg';

function recolour(svg, palette, team) {
  let out = svg;
  for (const [from, to] of Object.entries(palette)) out = out.replaceAll(from, to[team]);
  return out;
}

async function rasterize(svg, pose) {
  const img = new Image();
  img.src = toUrl(svg);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = RASTER_W;
  c.height = Math.round(RASTER_W * (pose.h / pose.w));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Split one recoloured drawing into { body, legs: [{ img, hip }] }, or null if its legs can't be found. */
async function buildLayers(svg, pose) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const groupOf = (prefix) => [...doc.querySelectorAll('path')]
    .find((p) => (p.getAttribute('d') || '').startsWith(prefix))?.parentNode;
  const outline = [...doc.querySelectorAll('path')].find((p) => /stroke/.test(getComputedStyleSafe(doc, p)));
  const legs = pose.legs.map((leg) => leg.paths.map(groupOf));
  if (!outline || legs.some((groups) => groups.some((g) => !g))) return null;
  const style = doc.querySelector('style') ? xml(doc.querySelector('style')) : '';
  const open = `<svg xmlns="${NS}" viewBox="0 0 ${pose.w} ${pose.h}">`;
  const legSvgs = pose.legs.map((leg, i) => {
    const [x, y, w, h] = leg.clip;
    return `${open}<defs>${style}<clipPath id="te-leg"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs>`
      + `${legs[i].map(xml).join('')}<g clip-path="url(#te-leg)">${xml(outline)}</g></svg>`;
  });
  // body: everything except the legs, with the outline cut away where the legs own it
  legs.flat().forEach((g) => g.remove());
  const defs = doc.querySelector('defs') ?? doc.documentElement.insertBefore(doc.createElementNS(NS, 'defs'), doc.documentElement.firstChild);
  const cp = doc.createElementNS(NS, 'clipPath');
  cp.setAttribute('id', 'te-body');
  for (const [x, y, width, height] of pose.bodyClip) {
    const rect = doc.createElementNS(NS, 'rect');
    Object.entries({ x, y, width, height }).forEach(([k, v]) => rect.setAttribute(k, String(v)));
    cp.appendChild(rect);
  }
  defs.appendChild(cp);
  outline.setAttribute('clip-path', 'url(#te-body)');
  const [body, ...legImgs] = await Promise.all([rasterize(xml(doc), pose), ...legSvgs.map((s) => rasterize(s, pose))]);
  return { w: pose.w, h: pose.h, body, legs: legImgs.map((img, i) => ({ img, hip: pose.legs[i].hip, foot: pose.legs[i].foot })) };
}

// The silhouette outline is the only stroked shape; find it by its class's CSS rather than a fixed class name.
function getComputedStyleSafe(doc, el) {
  const cls = el.getAttribute('class');
  if (!cls) return '';
  const css = doc.querySelector('style')?.textContent ?? '';
  const rule = css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
  return rule && /stroke:\s*#/.test(rule[1]) ? 'stroke' : '';
}

async function loadPose(name) {
  const pose = POSES[name];
  const res = await fetch(new URL(pose.file, import.meta.url));
  if (!res.ok) throw new Error(`${pose.file}: ${res.status}`);
  const svg = await res.text();
  await Promise.all([0, 1].map(async (team) => {
    const out = recolour(svg, pose.palette, team);
    urls[name][team] = toUrl(out);
    try {
      layers[name][team] = await buildLayers(out, pose);
    } catch (err) {
      console.warn(`Team Escape: no leg animation for ${pose.file}.`, err);
    }
  }));
}

export const characterReady = Promise.all([
  loadPose('front').catch((err) => console.warn('Team Escape character art failed to load; using the fallback sprite.', err)),
  loadPose('walk').catch((err) => console.warn('Team Escape walking art failed to load; the front view will be used.', err)),
]).then(() => Boolean(urls.front[0]));

/** Layers ({ w, h, body, legs }) for a pose ('front' | 'walk'), or null if unavailable. */
export const characterLayers = (team, pose = 'front') => layers[pose][team === 1 ? 1 : 0];

/** Data URL of the team's front-view character, or null until characterReady resolves (or if loading failed). */
export const characterUrl = (team) => urls.front[team === 1 ? 1 : 0];

/** Decoded front-view image for canvas drawing (null until it's ready). */
export function characterImage(team) {
  const t = team === 1 ? 1 : 0;
  if (!urls.front[t]) return null;
  if (!images[t]) {
    images[t] = new Image();
    images[t].src = urls.front[t];
  }
  return images[t].complete && images[t].naturalWidth ? images[t] : null;
}
