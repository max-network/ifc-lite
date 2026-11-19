# @ifc-lite/validate parity report

Generated 2026-11-19 by `parity/run-parity.ts`. Oracle: ifcopenshell.validate (express_rules=True) 0.9.0.post1.
Findings are compared per rule and instance. TP: both report it; FP: only we do; FN: only the oracle does.

## Rule compilation

| Schema | Scope | Entity WHERE | Type WHERE | Global | Compiled |
|---|---|---:|---:|---:|---:|
| IFC4_ADD2_TC1 | all | 652/652 | 25/25 | 2/2 | 100% |
| IFC4_ADD2_TC1 | authoring | 95/95 | 13/13 | 2/2 | 100% |
| IFC4X3_DEV_923b0514 | all | 752/752 | 25/25 | 2/2 | 100% |
| IFC4X3_DEV_923b0514 | authoring | 101/101 | 13/13 | 2/2 | 100% |
| IFC2X3 | all | 339/339 | 24/24 | 2/2 | 100% |

Every WHERE rule, DERIVE expression, FUNCTION and global RULE compiled; nothing is reported as not evaluated.

## Totals

73 files: TP 245, FP 2, FN 0. FN on the crafted corpus: 0.

## Targeted defects (crafted corpus)

| File | Targets | We detect | Oracle detects |
|---|---|---|---|
| wall-userdefined-without-objecttype.ifc | `IfcWall.CorrectPredefinedType` | yes | yes |
| door-typed-by-wall-type.ifc | `IfcDoor.CorrectStyleAssigned` | yes | yes |
| window-typed-by-wall-type.ifc | `IfcWindow.CorrectStyleAssigned` | yes | yes |
| slab-userdefined-without-objecttype.ifc | `IfcSlab.CorrectPredefinedType` | yes | yes |
| space-userdefined-without-objecttype.ifc | `IfcSpace.CorrectPredefinedType` | yes | yes |
| wall-typed-by-slab-type.ifc | `IfcWall.CorrectTypeAssigned` | yes | yes |
| walltype-without-name.ifc | `IfcTypeObject.NameRequired` | yes | yes |
| storey-not-aggregated.ifc | `IfcSpatialStructureElement.WR41` | yes | yes |
| aggregates-self-reference.ifc | `IfcRelAggregates.NoSelfReference` | yes | yes |
| storey-contained-in-storey.ifc | `IfcRelContainedInSpatialStructure.WR31` | yes | yes |
| project-without-name.ifc | `IfcProject.HasName` | yes | yes |
| project-subcontext.ifc | `IfcProject.CorrectContext` | yes | yes |
| two-projects.ifc | `global:IfcSingleProjectInstance` | yes | yes |
| axis-without-refdirection.ifc | `IfcAxis2Placement3D.AxisAndRefDirProvision` | yes | yes |
| placement-location-2d.ifc | `IfcAxis2Placement3D.LocationIs3D` | yes | yes |
| placement-parallel-axes.ifc | `IfcAxis2Placement3D.AxisToRefDirPosition` | yes | yes |
| direction-zero.ifc | `IfcDirection.MagnitudeGreaterZero` | yes | yes |
| point-one-coordinate.ifc | `IfcCartesianPoint.CP2Dor3D` | yes | yes |
| extrusion-in-profile-plane.ifc | `IfcExtrudedAreaSolid.ValidExtrusionDirection` | yes | yes |
| rectangle-zero-width.ifc | `IfcPositiveLengthMeasure.WR1` | yes | yes |
| shape-without-type.ifc | `IfcShapeRepresentation.HasRepresentationType` | yes | yes |
| shape-wrong-type.ifc | `IfcShapeRepresentation.CorrectItemsForType` | yes | yes |
| shape-in-non-geometric-context.ifc | `IfcShapeRepresentation.CorrectContext` | yes | yes |
| shape-shared-by-two-products.ifc | `IfcShapeModel.WR11` | yes | yes |
| local-placement-3d-under-2d.ifc | `IfcLocalPlacement.WR21` | yes | yes |
| subcontext-userdefined-view.ifc | `IfcGeometricRepresentationSubContext.UserTargetProvided` | yes | yes |
| subcontext-explicit-derived.ifc | `derived-in-subtype` | yes | **no** |
| pset-without-name.ifc | `IfcPropertySet.ExistsName` | yes | yes |
| pset-duplicate-property-names.ifc | `IfcPropertySet.UniquePropertyNames` | yes | yes |
| two-psets-same-name.ifc | `IfcObject.UniquePropertySetNames` | yes | yes |
| quantity-negative-length.ifc | `IfcQuantityLength.WR22` | yes | yes |
| unit-wrong-dimensions.ifc | `IfcNamedUnit.WR1` | yes | yes |
| unit-assignment-duplicate-type.ifc | `IfcUnitAssignment.WR01` | yes | yes |
| ownerhistory-added-without-date.ifc | `IfcOwnerHistory.CorrectChangeAction` | yes | yes |
| person-without-name.ifc | `IfcPerson.IdentifiablePerson` | yes | yes |
| grid-without-placement.ifc | `IfcGrid.HasPlacement` | yes | yes |
| grid-axis-3d-curve.ifc | `IfcGridAxis.WR1` | yes | yes |
| polyline-mixed-dimensions.ifc | `IfcPolyline.SameDim` | yes | yes |
| profile-outer-curve-3d.ifc | `IfcArbitraryClosedProfileDef.WR1` | yes | yes |
| material-priority-out-of-range.ifc | `IfcMaterialLayer.NormalizedPriority` | yes | yes |
| wallstandardcase-without-layer-usage.ifc | `IfcWallStandardCase.HasMaterialLayerSetUsage` | yes | yes |
| opening-voids-nothing.ifc | `inverse-cardinality` | yes | yes |
| door-fills-two-openings.ifc | `inverse-cardinality` | yes | yes |
| wall-contained-twice.ifc | `inverse-cardinality` | yes | yes |
| defines-by-properties-on-type.ifc | `IfcRelDefinesByProperties.NoRelatedTypeObject` | yes | yes |
| duplicate-globalid.ifc | `IfcRoot.UR1` | yes | yes |
| globalid-invalid-characters.ifc | `guid-format` | yes | yes |
| wall-missing-globalid.ifc | `not-optional` | yes | yes |
| wall-name-integer.ifc | `invalid-type` | yes | yes |
| wall-placement-wrong-entity.ifc | `invalid-type` | yes | yes |
| point-integer-coordinates.ifc | `invalid-type` | yes | yes |
| wall-enum-unknown-item.ifc | `invalid-type` | yes | yes |
| wall-attribute-count.ifc | `attribute-count` | yes | yes |
| abstract-entity-instance.ifc | `abstract` | yes | yes |
| select-untyped-value.ifc | `invalid-type` | yes | yes |
| typed-value-in-plain-slot.ifc | `invalid-type` | yes | yes |
| header-author-not-list.ifc | `FILE_NAME.author` | yes | yes |

## Per rule, crafted corpus

| Rule | TP | FP | FN | TN files | Explanation |
|---|---:|---:|---:|---:|---|
| `derived-in-subtype` | 0 | 1 | 0 | 57 | FP: ISO 10303-21 requires `*` in a slot a subtype redeclares as DERIVE (IfcGeometricRepresentationSubContext.CoordinateSpaceDimension). IfcOpenShell does not report a value written there; the corpus file subcontext-explicit-derived.ifc shows it. |
| `abstract` | 2 | 0 | 0 | 56 |  |
| `attribute-count` | 1 | 0 | 0 | 57 |  |
| `global:ifcsingleprojectinstance` | 1 | 0 | 0 | 57 |  |
| `guid-format` | 1 | 0 | 0 | 57 |  |
| `header:file_name.author` | 1 | 0 | 0 | 57 |  |
| `ifcarbitraryclosedprofiledef.wr1` | 1 | 0 | 0 | 57 |  |
| `ifcaxis2placement2d.locationis2d` | 1 | 0 | 0 | 57 |  |
| `ifcaxis2placement3d.axisandrefdirprovision` | 1 | 0 | 0 | 57 |  |
| `ifcaxis2placement3d.axistorefdirposition` | 1 | 0 | 0 | 57 |  |
| `ifcaxis2placement3d.locationis3d` | 1 | 0 | 0 | 57 |  |
| `ifccartesianpoint.cp2dor3d` | 1 | 0 | 0 | 57 |  |
| `ifcdirection.magnitudegreaterzero` | 1 | 0 | 0 | 57 |  |
| `ifcdoor.correctstyleassigned` | 1 | 0 | 0 | 57 |  |
| `ifcextrudedareasolid.validextrusiondirection` | 1 | 0 | 0 | 57 |  |
| `ifcgeometricrepresentationcontext.north2d` | 2 | 0 | 0 | 57 |  |
| `ifcgeometricrepresentationsubcontext.usertargetprovided` | 1 | 0 | 0 | 57 |  |
| `ifcgrid.hasplacement` | 1 | 0 | 0 | 57 |  |
| `ifcgridaxis.wr1` | 1 | 0 | 0 | 57 |  |
| `ifclocalplacement.wr21` | 2 | 0 | 0 | 56 |  |
| `ifcmateriallayer.normalizedpriority` | 1 | 0 | 0 | 57 |  |
| `ifcnamedunit.wr1` | 1 | 0 | 0 | 57 |  |
| `ifcobject.uniquepropertysetnames` | 2 | 0 | 0 | 56 |  |
| `ifcownerhistory.correctchangeaction` | 1 | 0 | 0 | 57 |  |
| `ifcperson.identifiableperson` | 1 | 0 | 0 | 57 |  |
| `ifcpolyline.samedim` | 1 | 0 | 0 | 57 |  |
| `ifcpositivelengthmeasure.wr1` | 1 | 0 | 0 | 57 |  |
| `ifcproject.correctcontext` | 1 | 0 | 0 | 57 |  |
| `ifcproject.hasname` | 1 | 0 | 0 | 57 |  |
| `ifcpropertyset.existsname` | 1 | 0 | 0 | 57 |  |
| `ifcpropertyset.uniquepropertynames` | 1 | 0 | 0 | 57 |  |
| `ifcquantitylength.wr22` | 1 | 0 | 0 | 57 |  |
| `ifcrelaggregates.noselfreference` | 1 | 0 | 0 | 57 |  |
| `ifcrelcontainedinspatialstructure.wr31` | 1 | 0 | 0 | 57 |  |
| `ifcreldefinesbyproperties.norelatedtypeobject` | 1 | 0 | 0 | 57 |  |
| `ifcshapemodel.wr11` | 2 | 0 | 0 | 57 |  |
| `ifcshaperepresentation.correctcontext` | 1 | 0 | 0 | 57 |  |
| `ifcshaperepresentation.correctitemsfortype` | 2 | 0 | 0 | 56 |  |
| `ifcshaperepresentation.hasrepresentationtype` | 1 | 0 | 0 | 57 |  |
| `ifcslab.correctpredefinedtype` | 1 | 0 | 0 | 57 |  |
| `ifcspace.correctpredefinedtype` | 1 | 0 | 0 | 57 |  |
| `ifcspatialstructureelement.wr41` | 2 | 0 | 0 | 56 |  |
| `ifctypeobject.namerequired` | 1 | 0 | 0 | 57 |  |
| `ifcunitassignment.wr01` | 1 | 0 | 0 | 57 |  |
| `ifcwall.correctpredefinedtype` | 1 | 0 | 0 | 57 |  |
| `ifcwall.correcttypeassigned` | 2 | 0 | 0 | 57 |  |
| `ifcwallstandardcase.hasmateriallayersetusage` | 1 | 0 | 0 | 57 |  |
| `ifcwindow.correctstyleassigned` | 1 | 0 | 0 | 57 |  |
| `invalid-type` | 6 | 0 | 0 | 52 |  |
| `inverse-cardinality` | 5 | 0 | 0 | 53 |  |
| `not-optional` | 1 | 0 | 0 | 57 |  |
| `unique:ifcroot.ur1` | 1 | 0 | 0 | 57 |  |

## Per rule, whole corpus

| Rule | TP | FP | FN | TN files | Explanation |
|---|---:|---:|---:|---:|---|
| `derived-in-subtype` | 0 | 1 | 0 | 72 | FP: ISO 10303-21 requires `*` in a slot a subtype redeclares as DERIVE (IfcGeometricRepresentationSubContext.CoordinateSpaceDimension). IfcOpenShell does not report a value written there; the corpus file subcontext-explicit-derived.ifc shows it. |
| `global:ifcrepresentationcontextsamewcs` | 0 | 1 | 0 | 72 | FP: The rule tests `WorldCoordinateSystem :<>: ...`, instance inequality (ISO 10303-11 12.2.2). IfcOpenShell compiles it to `!=` under compare_instances_by_value, so two distinct but equal-valued placements skip the precision check. We keep instance semantics: the two contexts carry precisions $ and 1E-5. |
| `abstract` | 2 | 0 | 0 | 71 |  |
| `attribute-count` | 1 | 0 | 0 | 72 |  |
| `global:ifcsingleprojectinstance` | 1 | 0 | 0 | 72 |  |
| `guid-format` | 1 | 0 | 0 | 72 |  |
| `header:file_name.author` | 2 | 0 | 0 | 71 |  |
| `header:file_name.organization` | 1 | 0 | 0 | 72 |  |
| `ifcarbitraryclosedprofiledef.wr1` | 1 | 0 | 0 | 72 |  |
| `ifcarbitraryopenprofiledef.wr12` | 4 | 0 | 0 | 72 |  |
| `ifcaxis2placement2d.locationis2d` | 1 | 0 | 0 | 72 |  |
| `ifcaxis2placement3d.axisandrefdirprovision` | 1 | 0 | 0 | 72 |  |
| `ifcaxis2placement3d.axistorefdirposition` | 1 | 0 | 0 | 72 |  |
| `ifcaxis2placement3d.locationis3d` | 1 | 0 | 0 | 72 |  |
| `ifccartesianpoint.cp2dor3d` | 1 | 0 | 0 | 72 |  |
| `ifcdirection.magnitudegreaterzero` | 1 | 0 | 0 | 72 |  |
| `ifcdoor.correctstyleassigned` | 1 | 0 | 0 | 72 |  |
| `ifcextrudedareasolid.validextrusiondirection` | 1 | 0 | 0 | 72 |  |
| `ifcgeometricrepresentationcontext.north2d` | 2 | 0 | 0 | 72 |  |
| `ifcgeometricrepresentationsubcontext.usertargetprovided` | 1 | 0 | 0 | 72 |  |
| `ifcgrid.hasplacement` | 1 | 0 | 0 | 72 |  |
| `ifcgridaxis.wr1` | 1 | 0 | 0 | 72 |  |
| `ifclocalplacement.wr21` | 2 | 0 | 0 | 71 |  |
| `ifcmateriallayer.normalizedpriority` | 1 | 0 | 0 | 72 |  |
| `ifcnamedunit.wr1` | 1 | 0 | 0 | 72 |  |
| `ifcobject.uniquepropertysetnames` | 2 | 0 | 0 | 71 |  |
| `ifcownerhistory.correctchangeaction` | 2 | 0 | 0 | 71 |  |
| `ifcperson.identifiableperson` | 1 | 0 | 0 | 72 |  |
| `ifcpolyline.samedim` | 1 | 0 | 0 | 72 |  |
| `ifcpositivelengthmeasure.wr1` | 1 | 0 | 0 | 72 |  |
| `ifcpositiveratiomeasure.wr1` | 8 | 0 | 0 | 72 |  |
| `ifcproject.correctcontext` | 1 | 0 | 0 | 72 |  |
| `ifcproject.hasname` | 1 | 0 | 0 | 72 |  |
| `ifcpropertyset.existsname` | 1 | 0 | 0 | 72 |  |
| `ifcpropertyset.uniquepropertynames` | 1 | 0 | 0 | 72 |  |
| `ifcquantitylength.wr22` | 10 | 0 | 0 | 71 |  |
| `ifcrelaggregates.noselfreference` | 1 | 0 | 0 | 72 |  |
| `ifcrelcontainedinspatialstructure.wr31` | 1 | 0 | 0 | 72 |  |
| `ifcreldefinesbyproperties.norelatedtypeobject` | 1 | 0 | 0 | 72 |  |
| `ifcrelspaceboundary.correctphysorvirt` | 5 | 0 | 0 | 72 |  |
| `ifcshapemodel.wr11` | 142 | 0 | 0 | 71 |  |
| `ifcshaperepresentation.correctcontext` | 1 | 0 | 0 | 72 |  |
| `ifcshaperepresentation.correctitemsfortype` | 2 | 0 | 0 | 71 |  |
| `ifcshaperepresentation.hasrepresentationtype` | 1 | 0 | 0 | 72 |  |
| `ifcslab.correctpredefinedtype` | 1 | 0 | 0 | 72 |  |
| `ifcspace.correctpredefinedtype` | 1 | 0 | 0 | 72 |  |
| `ifcspatialstructureelement.wr41` | 2 | 0 | 0 | 71 |  |
| `ifctypeobject.namerequired` | 3 | 0 | 0 | 71 |  |
| `ifcunitassignment.wr01` | 1 | 0 | 0 | 72 |  |
| `ifcwall.correctpredefinedtype` | 1 | 0 | 0 | 72 |  |
| `ifcwall.correcttypeassigned` | 2 | 0 | 0 | 72 |  |
| `ifcwallstandardcase.hasmateriallayersetusage` | 1 | 0 | 0 | 72 |  |
| `ifcwindow.correctstyleassigned` | 1 | 0 | 0 | 72 |  |
| `invalid-type` | 6 | 0 | 0 | 67 |  |
| `inverse-cardinality` | 6 | 0 | 0 | 67 |  |
| `not-optional` | 6 | 0 | 0 | 71 |  |
| `unique:ifcroot.ur1` | 1 | 0 | 0 | 72 |  |

## Files

| File | Schema | Ours | Oracle | TP | FP | FN | ms |
|---|---|---:|---:|---:|---:|---:|---:|
| packages/validate/parity/corpus/base-ifc4.ifc | IFC4_ADD2_TC1 | 0 | 0 | 0 | 0 | 0 | 109 |
| packages/validate/parity/corpus/broken/wall-userdefined-without-objecttype.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 7 |
| packages/validate/parity/corpus/broken/door-typed-by-wall-type.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 6 |
| packages/validate/parity/corpus/broken/window-typed-by-wall-type.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/slab-userdefined-without-objecttype.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/space-userdefined-without-objecttype.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/wall-typed-by-slab-type.ifc | IFC4_ADD2_TC1 | 2 | 2 | 2 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/walltype-without-name.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/storey-not-aggregated.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/aggregates-self-reference.ifc | IFC4_ADD2_TC1 | 3 | 3 | 3 | 0 | 0 | 6 |
| packages/validate/parity/corpus/broken/storey-contained-in-storey.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 6 |
| packages/validate/parity/corpus/broken/project-without-name.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 6 |
| packages/validate/parity/corpus/broken/project-subcontext.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/two-projects.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/axis-without-refdirection.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 5 |
| packages/validate/parity/corpus/broken/placement-location-2d.ifc | IFC4_ADD2_TC1 | 2 | 2 | 2 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/placement-parallel-axes.ifc | IFC4_ADD2_TC1 | 3 | 3 | 3 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/direction-zero.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/point-one-coordinate.ifc | IFC4_ADD2_TC1 | 2 | 2 | 2 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/extrusion-in-profile-plane.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/rectangle-zero-width.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/shape-without-type.ifc | IFC4_ADD2_TC1 | 2 | 2 | 2 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/shape-wrong-type.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/shape-in-non-geometric-context.ifc | IFC4_ADD2_TC1 | 2 | 2 | 2 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/shape-shared-by-two-products.ifc | IFC4_ADD2_TC1 | 2 | 2 | 2 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/local-placement-3d-under-2d.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/subcontext-userdefined-view.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 5 |
| packages/validate/parity/corpus/broken/subcontext-explicit-derived.ifc | IFC4_ADD2_TC1 | 1 | 0 | 0 | 1 | 0 | 3 |
| packages/validate/parity/corpus/broken/pset-without-name.ifc | IFC4_ADD2_TC1 | 2 | 2 | 2 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/pset-duplicate-property-names.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/two-psets-same-name.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/quantity-negative-length.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/unit-wrong-dimensions.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/unit-assignment-duplicate-type.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/ownerhistory-added-without-date.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/person-without-name.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/grid-without-placement.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/grid-axis-3d-curve.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 1 |
| packages/validate/parity/corpus/broken/polyline-mixed-dimensions.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 1 |
| packages/validate/parity/corpus/broken/profile-outer-curve-3d.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/material-priority-out-of-range.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/wallstandardcase-without-layer-usage.ifc | IFC4_ADD2_TC1 | 2 | 2 | 2 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/opening-voids-nothing.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/door-fills-two-openings.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/wall-contained-twice.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/defines-by-properties-on-type.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 1 |
| packages/validate/parity/corpus/broken/duplicate-globalid.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/globalid-invalid-characters.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/wall-missing-globalid.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/wall-name-integer.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/wall-placement-wrong-entity.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/point-integer-coordinates.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 6 |
| packages/validate/parity/corpus/broken/wall-enum-unknown-item.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/wall-attribute-count.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 4 |
| packages/validate/parity/corpus/broken/abstract-entity-instance.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/select-untyped-value.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 3 |
| packages/validate/parity/corpus/broken/typed-value-in-plain-slot.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 2 |
| packages/validate/parity/corpus/broken/header-author-not-list.ifc | IFC4_ADD2_TC1 | 1 | 1 | 1 | 0 | 0 | 1 |
| tests/models/ara3d/AC20-FZK-Haus.ifc | IFC4_ADD2_TC1 | 170 | 170 | 170 | 0 | 0 | 476 |
| tests/models/ara3d/IfcOpenHouse_IFC4.ifc | IFC4_ADD2_TC1 | 0 | 0 | 0 | 0 | 0 | 21 |
| tests/models/buildingsmart/Building-Architecture.ifc | IFC4_ADD2_TC1 | 0 | 0 | 0 | 0 | 0 | 16 |
| tests/models/buildingsmart/Building-Structural.ifc | IFC4_ADD2_TC1 | 0 | 0 | 0 | 0 | 0 | 27 |
| tests/models/buildingsmart/wall-with-opening-and-window.ifc | IFC4_ADD2_TC1 | 0 | 0 | 0 | 0 | 0 | 3 |
| tests/models/buildingsmart/Infra-Road.ifc | IFC4_ADD2_TC1 | 0 | 0 | 0 | 0 | 0 | 51 |
| tests/models/buildingsmart/Infra-Bridge.ifc | IFC4_ADD2_TC1 | 0 | 0 | 0 | 0 | 0 | 118 |
| tests/models/modelling/saved-building.ifc | IFC4_ADD2_TC1 | 0 | 0 | 0 | 0 | 0 | 5 |
| tests/models/various/issue-604-door.ifc | IFC4_ADD2_TC1 | 4 | 4 | 4 | 0 | 0 | 35 |
| tests/models/ara3d/duplex.ifc | IFC2X3 | 0 | 0 | 0 | 0 | 0 | 433 |
| tests/models/buildingsmart/annex_e/basic-geometric-shape/extruded-solid.ifc | IFC4X3_DEV_923b0514 | 0 | 0 | 0 | 0 | 0 | 65 |
| tests/models/buildingsmart/annex_e/tessellated-shape/polygonal-face-tessellation.ifc | IFC4X3_DEV_923b0514 | 0 | 0 | 0 | 0 | 0 | 2 |
| tests/models/ifcopenshell/generated_structural_coverage_ifc4x3.ifc | IFC4X3_DEV_923b0514 | 0 | 0 | 0 | 0 | 0 | 3 |
| apps/viewer/public/samples/hello-wall.ifc | IFC4_ADD2_TC1 | 2 | 2 | 2 | 0 | 0 | 15 |
| apps/viewer/public/samples/building-architecture-rev-b.ifc | IFC4_ADD2_TC1 | 2 | 1 | 1 | 1 | 0 | 20 |

