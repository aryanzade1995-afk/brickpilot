# Brief → plan audit

Reviewed README and commits `cbfefce`, `266b5a3`, `0435101`, plus the integrated
Blender checkpoint. A changed hash alone does not count as a meaningful plan
effect. Ages are represented by the existing infant/child/teen/adult/senior
groups; there is no numeric age input. Explicit requested room counts remain
minimum requests, with additional household necessities listed in the programme.

| Brief field | Changed the plan before? | Planning effect after this upgrade |
| --- | --- | --- |
| project.name | Metadata | Drawing/report title; no invented room requirement |
| project.buildingType | Yes | Existing large-villa area and courtyard programme |
| site.plotWidth / plotDepth | Yes | Oriented plot and buildable envelope |
| site.facing / roadEdges | Yes | Approach and compass orientation |
| site.setbacks.N/E/S/W | Yes | Mandatory minimum envelope |
| household.members count | Partly | Social capacity targets and parking capacity use actual members |
| household.members.role: adult | Suggestion only | Household capacity and resident/guest allocation |
| household.members.role: senior | Yes | Ground-floor bedrooms when needed |
| household.members.role: teen / child | No | Named child/teen rooms, master-floor allocation and proximity ranking |
| household.members.role: infant | No | More master-room area for cot/care, no separate infant bedroom |
| household.members.needsGroundFloor | Yes | Ground-floor distribution and attached-bath hard check |
| household.guests: rare / occasional | Suggestion only | Occasional flexible study; rare does not add it |
| household.guests: frequent | No | Guest room and attached bath, larger social target |
| household.staff: daily | No | Utility and accessible ground-floor toilet programme |
| household.staff: liveIn | No | Staff bedroom + shower/toilet beside the utility wing |
| spaces.occupants | Legacy only | Retained on old briefs; actual members drive current capacity |
| spaces.stepFree | Yes | Ground bedroom and bathroom, unchanged hard checks |
| spaces.livingDining | Yes | Separate or combined room programme |
| lifestyle.kitchen | Yes | Existing closed/semi/open opening treatment |
| lifestyle.dryWetSplit | Partly | Creates real wet kitchen even if utility was unchecked |
| lifestyle.wfhCount | Score only | Supplies studies and workstation area, bedroom separation ranking |
| lifestyle.clientVisits | Conditional | Entrance office even if studies/WFH counters were zero |
| lifestyle.vastu | Yes | Existing compass ranking and strict-rule reporting |
| levels.storeys | Yes | Floor count and room distribution |
| levels.floorToFloor | Yes | Stair riser/run sizing and floor heights |
| levels.stairWidth | Yes | Existing sized, aligned stair core |
| levels.liftProvision | Yes | Stacked shaft and hard checks |
| rooms.bedroomsWithBath / bedroomsNoBath | Yes | Requested bedrooms and attached bathrooms retained |
| rooms.sharedBaths | Yes | Requested common bathrooms retained |
| rooms.studies | Yes | Requested studies retained; household requirements can add a study |
| rooms.balcony | Yes | Existing accessible supported balcony placement |
| rooms.priorities.coveredParking | Yes | Covered parking programme |
| rooms.priorities.coveredVerandah | Yes | Verandah / sit-out programme |
| rooms.priorities.utility | Yes | Utility; wet-kitchen/staff requirements can also require it |
| rooms.priorities.pooja | Yes | Optional sacred room |
| rooms.poojaPreference (new) | Absent | Compact/dedicated/large area requirement |
| rooms.poojaSide (new) | Absent | Requested compass-side placement ranking |
| rooms.priorities.courtyard | Yes | Mandatory open court and existing validity checks |
| rooms.priorities.garden | No in planner | Canonical outdoor programme, placed in Part 2 |
| rooms.priorities.compoundWall | No in 2D | Canonical boundary programme, drawn in Part 2 |
| style.massing | Yes | Existing valid plate families |
| style.character | 3D/window treatment | Existing window width and architectural treatment |
| style.diversity / personality | Exterior | Existing seeded exterior variation, not a new room programme |
| entry.primarySide | Yes | Approach and plan rotation |
| entry.mainDoorWidth | Yes | Existing real door and hall sizing |
| variation | Yes | Existing seeded layout selection |

Implementation: `canonical.ts` derives requirements, `planner/program.ts`
preserves suites/bedroom wings and `score.ts` evaluates actual relationships and
room placement. Construction cost is an independent estimate; spending constraints
do not change the programme. Minimum widths, area, egress, opening, support and
setback hard checks remain mandatory. An oversized household on a small plot is
reported as infeasible rather than removing rooms or weakening checks.


Part 2 completion: garden, compound wall, sit-out and utility yard now read the
actual available plot geometry. `site.openSpace` changes the effective envelope
and edge placement; `rooms.pool` adds a checked outdoor pool without changing the
room programme. Parts 2 and 3 keep seeded generation and all hard checks.
