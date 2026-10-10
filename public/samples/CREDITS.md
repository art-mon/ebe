# Sample credits

Lumen's sampled instruments are free recordings made and shared by other people. Thank you!

Files were downloaded unchanged from the commits listed below and renamed: melodic samples to the MIDI note they sound (`60.mp3` is middle C), drum hits to the pad they play (`kick.m4a`). At load time Lumen trims leading silence, levels and loops them in the browser (and tunes, filters and saturates some drum kits); the files themselves are not edited. Kits that reuse a hit from another kit point to its file (`../kit-acoustic/hat.m4a`). `index.json` lists every file and the URL it came from.

| Folder | Instrument | Source | Licence |
|---|---|---|---|
| `piano` | Salamander Grand Piano (Yamaha C5) by **Alexander Holm** | [Tonejs/audio @ efd8296](https://github.com/Tonejs/audio/tree/efd8296360f9526e379bfbe5c1698ff54d6a1d34/salamander) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| `epiano`, `clavinet`, `organ`, `strings`, `choir`, `warmpad`, `harp`, `pizzicato`, `bass-fretless`, `bass-synth`, `bass-picked` | FluidR3 General MIDI SoundFont by **Frank Wen**, rendered per note by Benjamin Gleitzman | [gleitz/midi-js-soundfonts @ 044fab8](https://github.com/gleitz/midi-js-soundfonts/tree/044fab8e1456bfafc5776e86dfd6bb8697149aef/FluidR3_GM) | MIT (SoundFont, notice below); renders labelled [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) |
| `vibraphone`, and the clap and rim in `kit-acoustic` | Versilian Community Sample Library by **Versilian Studios**, AAC conversion by danigb | [danigb/samples @ eae8c5c](https://github.com/danigb/samples/tree/eae8c5c7a10f4b0e06281211e704c36c30e25342/audio/vcsl) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `bass-finger`, `bass-upright` | glowlybass (Squier Jazz Bass) and 1958 Otto Rubner double bass by **D. Smolken** / Karoryfer Samples | [danigb/samples @ eae8c5c](https://github.com/danigb/samples/tree/eae8c5c7a10f4b0e06281211e704c36c30e25342/audio/dsmolken) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `guitar-nylon`, `guitar-electric`, `flute`, `sax`, `violin` | tonejs-instruments by **Nicholaus P. Brosowsky**, from VSCO 2 (Versilian Studios), Karoryfer Samples, University of Iowa MIS and Freesound user quartertone | [nbrosowsky/tonejs-instruments @ 622c2f1](https://github.com/nbrosowsky/tonejs-instruments/tree/622c2f1c32c8cfce4158ddc3eb26e518ddef37e5/samples) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (the nylon guitar source is [CC BY 4.0](https://freesound.org/people/quartertone/sounds/183078/)) |
| `kit-acoustic` (kick, snare, hats, tom, crash) | Sonic Pi sample set, from Freesound users **menegass**, **Zajo** and **Neotone** | [smpldsnds/sonic-pi-samples @ b39c72b](https://github.com/smpldsnds/sonic-pi-samples/tree/b39c72bd79024e6eec58c4f55c333ede79b700b6/samples) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `kit-triphop`, `kit-downtempo`, `kit-garage`, `kit-deephouse`, `kit-soft` | More of the Sonic Pi sample set (kicks, snares, hats, snaps, tabla, electronic percussion, a vinyl scratch), from Freesound users including **EKVelika**, **zgump**, **cubix**, **Dolfeus**, **hullum**, **looppool**, **SoundCollectah**, **Peram**, **TheEndOfACycle**, **cabled_mess**, **PSYCHO BOOMER**, **zinzan_101**, **AlaskaRobotics**, **dio_333**, **hello_flowers** and **menegass** (each file's source is in `index.json`) | [smpldsnds/sonic-pi-samples @ b39c72b](https://github.com/smpldsnds/sonic-pi-samples/tree/b39c72bd79024e6eec58c4f55c333ede79b700b6/samples) | [CC0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `kit-808` | Roland TR-808 sample set 1.0.0 by **Michael Fischer** / Technopolis (1994) | [smpldsnds/drum-machines @ a894cb8](https://github.com/smpldsnds/drum-machines/tree/a894cb8c72abe15b05e7b4fd4b8ee561c0f9e960/TR-808) | Distributed as freeware; see the original `kit-808/TR808.TXT` |
| `kit-electro` | uzu-drumkit (TidalCycles) by **Mot4i** and **Switch Angel** | [tidalcycles/uzu-drumkit @ 2f3e05c](https://github.com/tidalcycles/uzu-drumkit/tree/2f3e05c70ab4d73ad053a1467adec89bd27377a0) | [Unlicense](https://unlicense.org/) (public domain) |

## FluidR3 licence

FluidR3_GM SoundFont, Copyright (c) 2000-2002, 2008 Frank Wen. Per-note renders from midi-js-soundfonts, Copyright (c) 2012 Benjamin Gleitzman.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
