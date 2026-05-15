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
];

export function normalizeDocumentId(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
}

export const collaborators = rawCollaborators.map((collaborator, index) => ({
  ...collaborator,
  id: `collaborator-${index + 1}`,
  normalizedDocumentId: normalizeDocumentId(collaborator.documentId),
}));

export const collaboratorMap = Object.fromEntries(
  collaborators.map((collaborator) => [collaborator.id, collaborator])
);

export const collaboratorByDocumentId = Object.fromEntries(
  collaborators.map((collaborator) => [
    collaborator.normalizedDocumentId,
    collaborator,
  ])
);
