# Representative work-trip expiry

The traffic game models aggregate demand, not actual journeys. A new private
vehicle is labelled as a work trip only when its representative origin and
destination frontages match an existing home and employer assignment. No new
demand is created. A worker whose employer is outside the generator's selected
representative OD endpoints is not covered; existing unlabelled vehicles cannot
be identified retrospectively. Taxi, bus and rail journeys are not work-labelled.

The shared game policy considers the morning departure window from 06:30 and
work ended at 17:00. These are simulated conventions, not individual shift data.
When frames skip a work window, the latest crossed window may label one normal
worker step; the implementation never catches up by spawning additional steps.

After the deadline, an identified car is removed only while actually blocked,
after a signal-cycle grace without a car-length of real presenter route progress.
Paused or hidden time does not add to the grace.
Work identity, presentation occupancy and worker requests use explicit,
acknowledged cancellation; no city, citizen, account or save is deleted.
