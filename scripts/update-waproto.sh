#!/bin/bash
# Met à jour le WAProto depuis WhiskeySockets/Baileys
# Usage: bash scripts/update-waproto.sh

echo "Fetching latest WAProto from WhiskeySockets/Baileys..."
git fetch upstream --depth=1

echo "Updating WAProto files..."
git checkout upstream/master -- WAProto/index.js
git checkout upstream/master -- WAProto/index.d.ts

echo "Done. Review changes then commit:"
echo "  git add WAProto/"
echo "  git commit -m 'chore: update WAProto from upstream'"
