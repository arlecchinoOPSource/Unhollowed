/** Modules this build can embed. Keep in step with src-tauri/src/modules.rs. */
export type ModuleName = 'swish';

export const MODULES: readonly { name: ModuleName; title: string }[] = [{ name: 'swish', title: 'Swish' }];

/** Where a built module bundle is served from (scripts/build-modules.mjs writes it). */
export const moduleUrl = (name: ModuleName) => `modules/${name}/index.html?mod=${name}`;
