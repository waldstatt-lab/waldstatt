# Problem

Once a settlement in the Waldstatt stands, it stands for good.
Apart from the Klause, the churches and the Kloster, which decay without food
and books, nothing a visitor builds ever needs attention again, and tearing a
building down always returns half its costs, so mistakes cost little. A grown
settlement asks for nothing but more of the same.

The work succeeds when:

- every building wears with time, stone slower than wood, large buildings
  slower than small ones, and fields and pens fastest;
- a visitor sees at a glance how worn a building is, on the map and in the plan;
- repairs cost goods and Waldleute's work, and a visitor can order them one by
  one or for all buildings chosen by their condition;
- a building worn out falls into ruins that do nothing, weigh on motivation,
  and cannot be repaired, only cleared away with much work, which needs a
  Recyclinghof;
- tearing down returns nothing unless a Recyclinghof stands within 10 km.

# Solution

- **Condition.** Each finished building has a condition in points, the years
  of play it lasts from new: by its material (fields and pens 6, wood 20, wood
  and stone 32, stone 50) for 2 × 2 tiles, growing with the square root of its
  footprint. It loses a point a year, 40 seconds. The upkeep of the Klause,
  churches and Kloster no longer mends them; without it they decay faster.
- **Looks.** Below two thirds a building is worn (stains, moss), below a third
  crumbling (cracks, holes), at none a ruin (the upper part fallen in, rubble,
  fields gone to weeds). The art paints this over each building's picture.
- **Ruins** do nothing: no beds, crew, effect, crossing or ship; a worn-out dam
  breaks and sends the flood wave. They lower motivation, 4 % each, at most
  20 %. The average condition of the rest lowers it below 50 % and raises it
  above 80 %.
- **Repair.** The tool «Reparieren» (key r), a building's card and the «:»
  finder order repairs. A repair costs half the building's costs as far as it
  is worn, paid at once; Waldleute then work on it like a building site. The
  finder's `reparieren:…` commands choose buildings by condition: crumbling,
  worn, all, under a number of points, or a number typed.
- **Recyclinghof.** A new building, appearing once a Steinbruch stands. Within
  its 10 km, tearing down returns half the costs as far as the building is not
  worn, and ruins can be cleared away (one by one, or all with
  `wegräumen:ruinen`), which returns nothing and takes four times the
  building's work. Without it, ruins stay.

# Security

No network, storage format or untrusted input changes beyond two optional
building fields in the save (an ordered repair and a ruin being cleared),
validated like the others; saves without them load as before.

# Rabbit Holes

- **A new save version.** The condition stays a share from 0 to 1, as the save
  already holds it, so saves and saved forests need no migration.
- **Carrying goods to repairs.** Goods are not carried in this game; a repair
  is paid when it is ordered.
- **Painting every kind's ruin by hand.** One generic pass over the existing
  art makes the wear levels for every kind and size.

# No-Gos

- No wear of building sites, drowned buildings or the Brot auswerfen.
- No automatic repairs.
- No cancelling an ordered repair.
- No repairing or rebuilding ruins.
