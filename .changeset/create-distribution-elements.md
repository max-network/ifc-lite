---
"@ifc-lite/create": minor
---

`addFlowPathElementToStore` writes a flow segment or fitting (IfcPipeSegment, IfcPipeFitting, IfcDuctSegment, ...) as an IfcSweptDiskSolid along a polyline, hollow when an inner diameter is given, with an IfcDistributionPort at each end nested through IfcRelNests. `addDistributionElementToStore` writes any IfcDistributionElement (sanitary terminals, space heaters, boilers, tanks, ...) from extruded polygon or circle solids, a void subtracted as an IfcBooleanResult, and nested ports placed with their outward direction. `connectPortsInStore` writes IfcRelConnectsPorts, `addDistributionSystemToStore` an IfcDistributionSystem with its IfcRelServicesBuildings, and `assignToGroupInStore` an IfcRelAssignsToGroup. Attributes are laid out from the target schema's registry; IFC2X3 is refused.
