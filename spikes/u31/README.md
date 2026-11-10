# U-31 embedding-model spike (throwaway)

Not production code. Answers, with synthetic fixtures only, how Tauri 2 isolates (or fails to isolate) module commands, DOM state and storage in four embedding models. Findings and decision: `docs/SPIKE-U31.md`.

Run (macOS; opens windows for about 14 s and writes JSON):

```sh
cd spikes/u31
cargo build -p u31-host --features custom-protocol
U31_OUT="$PWD/out.json" ./target/debug/u31-host
```

`results.json` is the output from the recorded run (Tauri 2.12.5, wry 0.57.2, macOS WKWebView). `alpha` and `beta` are two tiny Tauri plugins that both define `ping` and `finish_exit`. `host/dist` holds the test pages for each scenario.
