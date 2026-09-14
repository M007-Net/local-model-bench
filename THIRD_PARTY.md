# Third-party components

The application itself is MIT licensed; see [LICENSE](LICENSE). The bundled
components below are not covered by that license and keep their own upstream
terms, which travel with any copy you redistribute.

| Component | Bundled version / scope | License and source |
| --- | --- | --- |
| LibreHardwareMonitor | DLL 0.9.4.0, unmodified | MPL-2.0; `vendor/licenses/LibreHardwareMonitor-LICENSE.txt`; https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/tree/v0.9.4 |
| HidSharp | DLL 2.1.0.0, unmodified | Apache-2.0; `vendor/licenses/HidSharp-LICENSE.txt` and `HidSharp-NOTICE.txt`; https://www.zer7.com/software/hidsharp |
| GSM8K | Published test data | MIT; `vendor/benchmark-licenses/GSM8K-MIT.txt`; https://github.com/openai/grade-school-math |
| IFEval | Selected prompts and adapted checks | Apache-2.0; `vendor/benchmark-licenses/IFEval-Apache-2.0.txt`; https://github.com/google-research/google-research/tree/master/instruction_following_eval |
| CRUXEval | Selected output-prediction data | MIT; `vendor/benchmark-licenses/CRUXEval-MIT.txt`; https://github.com/facebookresearch/cruxeval |

## Bundled native libraries

These two DLLs ship in `vendor/` and are copied into the installer as
`extraResources`. They are unmodified upstream release builds. Verify them
against these fingerprints if you are reviewing or redistributing the source:

| File | Size (bytes) | File version | SHA-256 |
| --- | --- | --- | --- |
| `vendor/LibreHardwareMonitorLib.dll` | 712,192 | 0.9.4.0 (`0.9.4+b8077435b898d57539956388cddf49f7dacb86f7`) | `a0f2728f1734c236a9d02d9e25a88bc4f8cb7bd1faff1770726beb7af06bf8dc` |
| `vendor/HidSharp.dll` | 242,608 | 2.1.0.0 | `8c58e5fba22acc751032dfe97ce633e4f8a4c96089749bf316d55283b36649c2` |

They are read by `vendor/gpu-sampler.ps1` to sample GPU temperature, power, and
clocks. Nothing else loads them, and neither is used when the GPU panel is off.
Regenerate these values with:

```powershell
Get-FileHash -Algorithm SHA256 vendor\*.dll
```

Benchmark dataset SHA-256 fingerprints are embedded in `src/benchmark-data/packs.json` and saved with each run. Adaptations are described in the README and UI. The importer reads local upstream snapshots from `work/benchmark-sources`; normal builds use the bundled JSON and do not download datasets.

Packages compiled into the application bundle — react, react-dom, scheduler and
lucide-react — have their licence texts reproduced in full in
[THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), which `npm run build`
regenerates and the installer ships. The minifier strips the banner comments from
the bundle itself, so that file is where those notices live. Electron and the
remaining npm packages retain their own licenses. Install exact dependencies using `npm ci` and the committed lockfile. Electron's distributed license notices are included in the packaged application. Preserve bundled attribution files when redistributing source or installers.
