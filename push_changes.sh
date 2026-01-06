#!/bin/bash
cd /Users/marc/MyProjects/clientsvia-backend
git add -A
git commit -m "Fix Wiring Tab: V2 node counting + circular ref guards

- Fixed refresh() to correctly count V2 nodes from uiMap (tabs+sections+fields)
- Added recursion guards to renderNode/subtreeMatches/isDescendantOrSelf
- Fixed buildIndex to prevent circular parent-child refs
- Added MAX_DEPTH=20 safety limit
- Added visited Set tracking to prevent infinite loops"
git push origin main
echo "Done!"

