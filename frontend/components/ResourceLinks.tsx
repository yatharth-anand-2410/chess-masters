import type { Resource } from "./insights";

type ResourceLinksProps = {
  resources?: Resource[];
};

export default function ResourceLinks({ resources }: ResourceLinksProps) {
  if (!resources || resources.length === 0) {
    return null;
  }
  return (
    <div className="resource-links">
      {resources.map((resource) => (
        <a
          key={resource.url}
          href={resource.url}
          target="_blank"
          rel="noreferrer"
          className="resource-link"
        >
          <span className="resource-title">{resource.title}</span>
          {resource.source_move && (
            <span className="resource-move">{resource.source_move}</span>
          )}
        </a>
      ))}
    </div>
  );
}