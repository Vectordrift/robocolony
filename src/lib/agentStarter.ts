export interface StarterAction {
  type: string;
  params: Record<string, unknown>;
}

export interface StarterSettlement {
  id: string;
  name: string;
  buildings: Array<{ type?: string; level?: number }>;
  buildQueue: Array<{ type?: string; ticksRemaining?: number }>;
}

export interface StarterUnit {
  id: string;
  type: string;
  movementQueue?: unknown[];
}

export interface StarterState {
  colony: {
    status: string;
    resources: Record<string, number>;
  };
  settlements: StarterSettlement[];
  units: StarterUnit[];
}

function hasAffordableResources(
  resources: Record<string, number>,
  cost: Record<string, number>,
): boolean {
  for (const [key, value] of Object.entries(cost)) {
    if ((resources[key] ?? 0) < value) return false;
  }
  return true;
}

function settlementHasBuildingOrQueue(settlement: StarterSettlement, buildingType: string): boolean {
  return settlement.buildings.some((building) => building.type === buildingType)
    || settlement.buildQueue.some((item) => item.type === buildingType);
}

function findIdleScout(units: StarterUnit[]): StarterUnit | undefined {
  return units.find((unit) => unit.type === 'scout' && (!unit.movementQueue || unit.movementQueue.length === 0));
}

export function chooseStarterActions(state: StarterState): StarterAction[] {
  if (state.colony.status !== 'active') return [];

  const actions: StarterAction[] = [];
  const primarySettlement = state.settlements[0];
  const resources = state.colony.resources ?? {};

  if (primarySettlement) {
    const shouldBuildFarm = !settlementHasBuildingOrQueue(primarySettlement, 'farm')
      && hasAffordableResources(resources, { timber: 20 });

    if (shouldBuildFarm) {
      actions.push({
        type: 'build',
        params: {
          settlementId: primarySettlement.id,
          buildingType: 'farm',
        },
      });
    }

    const scoutCount = state.units.filter((unit) => unit.type === 'scout').length;
    const canTrainScout = scoutCount < 3 && hasAffordableResources(resources, { food: 10, timber: 5 });
    if (canTrainScout) {
      actions.push({
        type: 'train_unit',
        params: {
          settlementId: primarySettlement.id,
          unitType: 'scout',
        },
      });
    }
  }

  const idleScout = findIdleScout(state.units);
  if (idleScout) {
    actions.push({
      type: 'explore',
      params: {
        unitId: idleScout.id,
      },
    });
  }

  return actions.slice(0, 3);
}
