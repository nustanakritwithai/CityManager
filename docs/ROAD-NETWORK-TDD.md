# Road-network distance

This carries forward the routing purpose of PR #6 onto the current game. It is a
read-only diagnostic, not shipping, congestion or a travel-time estimate. It
does not change the save schema, simulation, money, inventory or ownership.

`shortestRoadRoute(city, from, to)` returns an inclusive list of road cells or
an empty list if no route exists. Endpoints may be roads or adjacent parcels;
all their road frontages are considered. Four-neighbor breadth-first search
finds the shortest uniform-cost route, with reproducible tie ordering.
`roadDistance` adds one entrance step per off-road endpoint and returns `null`
when disconnected. Gateway variants start at the city gateway. Units are grid
steps, not physical distance, congestion or travel time.

The inspector already reports a selected road's gateway distance using
`roadFacts`; connected non-road parcels now also report the distance including
their entrance step. Tests cover route correctness, disconnected road islands,
row-wrap rejection, invalid endpoints, agreement with road facts, and save/RNG
non-mutation. Browser smoke checks the selected building's displayed diagnostic.
Passing CI and independent review for the actual head remain release gates.
