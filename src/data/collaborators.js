const rawCollaborators = [
  {
    name: "Alvaro Adrian Diaz Campo",
    salary: 15000,
    documentId: "201-191195-0002U",
  },
  {
    name: "CARLOS JOSE MORA MORAGA",
    salary: 11350.08,
    documentId: "201-211069-0003K",
  },
  {
    name: "Dania Karel Espinoza Martinez",
    salary: 11350.08,
    documentId: "042-100586-0003V",
  },
  {
    name: "Daniel Antonio Cruz Marenco",
    salary: 11350.08,
    documentId: "201-050397-0002B",
  },
  {
    name: "David Alexander Lacayo Sosa",
    salary: 11350.08,
    documentId: "201-081198-1004T",
    branch: "Nindiri",
  },
  {
    name: "MICHAEL ERNESTO TORRES SILVA",
    salary: 11350.08,
    documentId: "201-220801-1003F",
    branch: "Nindiri",
  },
  {
    name: "Harvey Joffrey Mora Morales",
    salary: 11350.08,
    documentId: "201-180401-1000S",
  },
  {
    name: "JORDIN ALEXANDER GOMEZ CASTILLO",
    salary: 11350.08,
    documentId: "888-230901-1001K",
  },
  {
    name: "Jose Antonio Flores Gomez",
    salary: 11350.08,
    documentId: "201-120298-1000P",
  },
  {
    name: "Julio Cesar Amador Altamirano",
    salary: 11350.08,
    documentId: "001-230289-0010H",
  },
  {
    name: "Katherine Maria Obando Bermudez",
    salary: 11350.08,
    documentId: "201-220999-1005G",
  },
  {
    name: "Maria de Jesus Gomez Ubau",
    salary: 11350.08,
    documentId: "201-190189-0007S",
  },
  {
    name: "Michael Alexander Perez Romero",
    salary: 11350.08,
    documentId: "201-131093-0004N",
  },
  {
    name: "Nicol Yahoska Barbosa Rosales",
    salary: 15000,
    documentId: "201-080697-0005F",
  },
  {
    name: "Noel Alberto Hernandez Colomer",
    salary: 11350.08,
    documentId: "201-280591-0009E",
  },
  {
    name: "Noel Omar Bendana Bermudez",
    salary: 11350.08,
    documentId: "201-140888-0007H",
  },
  {
    name: "Oswaldo Antonio Lacayo Fuerte",
    salary: 15000,
    documentId: "201-130989-0003C",
  },
  {
    name: "Roberto Carlos Centeno",
    salary: 11350.08,
    documentId: "201-290981-0002E",
  },
  {
    name: "Jader Josue Saenz Melgara",
    salary: 11350.08,
    documentId: "246-251192-0000E",
    branch: "Masaya Gold",
  },
  {
    name: "Marion Sarai Vargas Arguello",
    salary: 11350.08,
    documentId: "201-021099-1003S",
    branch: "Masaya Gold",
  },
  {
    name: "Carlos Feliciano Rocha Sanchez",
    salary: 11350.08,
    documentId: "201-220586-0069F",
    branch: "Masaya Gold",
  },
  {
    name: "Huber Alexander Obando Nurinda",
    salary: 11350.08,
    documentId: "401-011199-1001X",
    branch: "Masaya Gold",
  },
  {
    name: "Luis Beltran Paz Bonilla",
    salary: 11350.08,
    documentId: "202-290669-0002S",
    branch: "Masaya Gold",
  },
];

export const DEFAULT_BRANCH = "Granada";

const BRANCH_ORDER = [DEFAULT_BRANCH, "Nindiri", "Masaya Gold"];
const LEGACY_DOCUMENT_ORDER_BEFORE_DAVID = [
  "201-191195-0002U",
  "201-211069-0003K",
  "042-100586-0003V",
  "201-050397-0002B",
  "201-180401-1000S",
  "888-230901-1001K",
  "201-120298-1000P",
  "001-230289-0010H",
  "201-220999-1005G",
  "201-190189-0007S",
  "201-131093-0004N",
  "201-080697-0005F",
  "201-280591-0009E",
  "201-140888-0007H",
  "201-130989-0003C",
  "201-290981-0002E",
];

export function normalizeDocumentId(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

export function normalizeBranchName(value) {
  const normalized = String(value ?? "").trim();
  return normalized || DEFAULT_BRANCH;
}

export function getCompanyNameForBranch(branch) {
  return `Carnes San Martin ${normalizeBranchName(branch)}`;
}

export const SHORT_DOCUMENT_ID_LENGTH = 5;

export function getShortDocumentId(value) {
  const normalized = normalizeDocumentId(value);
  if (!normalized) {
    return "";
  }

  return normalized.slice(-SHORT_DOCUMENT_ID_LENGTH);
}

export const collaborators = rawCollaborators.map((collaborator) => {
  const normalizedDocumentId = normalizeDocumentId(collaborator.documentId);

  return {
    ...collaborator,
    branch: normalizeBranchName(collaborator.branch),
    companyName: getCompanyNameForBranch(collaborator.branch),
    id: normalizedDocumentId,
    normalizedDocumentId,
  };
});

export const branches = Array.from(
  new Set(collaborators.map((collaborator) => collaborator.branch))
).sort((left, right) => {
  const leftOrder = BRANCH_ORDER.indexOf(left);
  const rightOrder = BRANCH_ORDER.indexOf(right);

  if (leftOrder !== -1 || rightOrder !== -1) {
    return (leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder) -
      (rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder);
  }

  return left.localeCompare(right);
});

export const collaboratorMap = Object.fromEntries(
  collaborators.map((collaborator) => [collaborator.id, collaborator])
);

export const collaboratorByDocumentId = Object.fromEntries(
  collaborators.map((collaborator) => [
    collaborator.normalizedDocumentId,
    collaborator,
  ])
);

function buildLegacyIndexMap(documentIds) {
  return Object.fromEntries(
    documentIds.map((documentId, index) => [
      `collaborator-${index + 1}`,
      normalizeDocumentId(documentId),
    ])
  );
}

const LEGACY_INDEX_TO_DOCUMENT_ID_BEFORE_DAVID = buildLegacyIndexMap(
  LEGACY_DOCUMENT_ORDER_BEFORE_DAVID
);

const LEGACY_INDEX_TO_DOCUMENT_ID_AFTER_DAVID = Object.fromEntries(
  collaborators.map((collaborator, index) => [
    `collaborator-${index + 1}`,
    collaborator.normalizedDocumentId,
  ])
);

export const collaboratorByShortDocumentId = collaborators.reduce(
  (collection, collaborator) => {
    const shortDocumentId = getShortDocumentId(collaborator.normalizedDocumentId);

    if (!shortDocumentId) {
      return collection;
    }

    collection[shortDocumentId] = collection[shortDocumentId] ? null : collaborator;
    return collection;
  },
  {}
);

export function getCollaboratorByClockCode(value) {
  const normalized = normalizeDocumentId(value);
  if (!normalized) {
    return null;
  }

  return (
    collaboratorByDocumentId[normalized] ??
    (normalized.length === SHORT_DOCUMENT_ID_LENGTH
      ? collaboratorByShortDocumentId[normalized] ?? null
      : null)
  );
}

export function resolveCollaboratorId(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) {
    return "";
  }

  const directMatch = collaboratorByDocumentId[normalizeDocumentId(rawValue)];
  if (directMatch) {
    return directMatch.id;
  }

  const legacyKey = rawValue.toLowerCase();
  if (!/^collaborator-\d+$/i.test(legacyKey)) {
    return "";
  }

  const legacyMap =
    LEGACY_INDEX_TO_DOCUMENT_ID_BEFORE_DAVID[legacyKey]
      ? LEGACY_INDEX_TO_DOCUMENT_ID_BEFORE_DAVID
      : LEGACY_INDEX_TO_DOCUMENT_ID_AFTER_DAVID;

  return legacyMap[legacyKey] || "";
}

export function getCollaboratorByEmployeeId(value, referenceTimestamp) {
  const collaboratorId = resolveCollaboratorId(value, referenceTimestamp);
  return collaboratorMap[collaboratorId] ?? null;
}
