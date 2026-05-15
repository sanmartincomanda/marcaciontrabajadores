const rawCollaborators = [
  { name: "Alvaro Adrian Diaz Campo", salary: 15000 },
  { name: "CARLOS JOSE MORA MORAGA", salary: 11350.08 },
  { name: "Dania Karel Espinoza Martinez", salary: 11350.08 },
  { name: "Daniel Antonio Cruz Marenco", salary: 11350.08 },
  { name: "Harvey Joffrey Mora Morales", salary: 11350.08 },
  { name: "JORDIN ALEXANDER GOMEZ CASTILLO", salary: 11350.08 },
  { name: "Jose Antonio Flores Gomez", salary: 11350.08 },
  { name: "Julio Cesar Amador Altamirano", salary: 11350.08 },
  { name: "Katherine Maria Obando Bermúdez", salary: 11350.08 },
  { name: "Maria de Jesus Gomez Ubau", salary: 11350.08 },
  { name: "Michael Alexander Perez Romero", salary: 11350.08 },
  { name: "Nicol Yahoska Barbosa Rosales", salary: 15000 },
  { name: "Noel Alberto Hernandez Colomer", salary: 11350.08 },
  { name: "Noel Omar Bendaña Bermudez", salary: 11350.08 },
  { name: "Oswaldo Antonio Lacayo Fuerte", salary: 15000 },
  { name: "Roberto Carlos Centeno", salary: 11350.08 },
];

export const collaborators = rawCollaborators.map((collaborator, index) => ({
  ...collaborator,
  id: `collaborator-${index + 1}`,
}));

export const collaboratorMap = Object.fromEntries(
  collaborators.map((collaborator) => [collaborator.id, collaborator])
);
