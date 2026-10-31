// The colours and lights of the two settings of the office: day is the light theme, night the dark one. The scene paints with them
// and so does the picture shown without WebGL. Numbers are sRGB hex.
export const THEMES = {
  light: {
    wall: 0xf7f3eb, wallSide: 0xece6da, trim: 0xffffff, floor: 0xedd9bb, slab: 0xd6bf9b, rug: 0xcfe7e0, desk: 0xf9f6f0, deskLeg: 0x8e909a,
    chair: 0x58627c, pot: 0xd98b61, leaf: 0x6dbb78, board: 0xffffff, frame: 0x9aa0ac, door: 0xc99f72,
    hemi: [0xffffff, 0xe3d3b8, 1.0], sun: [0xfff0d8, 2.5], skyTop: '#9fd3ff', skyBot: '#eaf6ff', shadow: 0.16, exposure: 1.12, glow: [0.5, 0.3], night: false,
  },
  dark: {
    wall: 0x3a4160, wallSide: 0x333a56, trim: 0x4a5272, floor: 0x4a4a5c, slab: 0x383848, rug: 0x3f6670, desk: 0x4b4e5f, deskLeg: 0x1e202a,
    chair: 0x2b3147, pot: 0x8d5a45, leaf: 0x3f8057, board: 0xcfd3e0, frame: 0x151824, door: 0x5a4a52,
    hemi: [0x8a9ce0, 0x2a2c40, 1.35], sun: [0xa9bdff, 1.1], skyTop: '#060a22', skyBot: '#1b2352', shadow: 0.22, exposure: 1.5, glow: [0.85, 0.5], night: true,
  },
};
