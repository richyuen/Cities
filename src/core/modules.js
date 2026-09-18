// Discover modules: every src/<id>/index.js (core has no index.js). Dynamic imports: a broken module rejects
// its own import and is isolated by the registry; it cannot break this file.
const globbed = import.meta.glob('../*/index.js');

export const loaders = {};
for (const [path, loader] of Object.entries(globbed)) {
  const id = path.split('/')[1];
  if (id === 'core') continue;
  loaders[id] = loader;
}

export const ALL_MODULE_IDS = Object.keys(loaders).sort();
