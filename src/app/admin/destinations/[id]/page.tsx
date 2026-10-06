import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SimpleForm } from "@/components/admin/admin-forms";
import { AdminHeader, Facts, InlineLink, StatusPill } from "@/components/admin/admin-ui";
import { Card } from "@/components/ui/feedback";
import { updateDestinationAction } from "@/server/actions/admin-listings";
import { requireAdmin } from "@/server/auth/admin-guard";
import { getAdminDestination } from "@/server/services/admin/destinations";

export const metadata: Metadata = { title: "Edit destination" };

export default async function AdminDestinationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin("admin:destinations:manage", `/admin/destinations/${id}`);
  const d = await getAdminDestination(id);
  if (!d) notFound();

  return (
    <>
      <AdminHeader
        eyebrow="Destination"
        title={d.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={d.isPublished ? "success" : "neutral"}>{d.isPublished ? "Published" : "Not published"}</StatusPill>
            {d.isPublished && <InlineLink href={`/destinations/${d.slug}`}>View public page</InlineLink>}
          </span>
        }
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-5">
          {/* Keyed by version so the form resets to fresh values after each save. */}
          <SimpleForm
            key={d.updatedAt.toISOString()}
            action={updateDestinationAction}
            hidden={{ destinationId: d.id, version: d.updatedAt.toISOString() }}
            submitLabel="Save destination"
            fields={[
              { type: "text", name: "name", label: "Name", required: true, defaultValue: d.name, maxLength: 80 },
              { type: "text", name: "adminArea", label: "State / region code", defaultValue: d.adminArea ?? "", maxLength: 10 },
              { type: "text", name: "tagline", label: "Tagline", defaultValue: d.tagline ?? "", maxLength: 140 },
              { type: "textarea", name: "summary", label: "Summary", defaultValue: d.summary ?? "", rows: 5, maxLength: 1200 },
              { type: "text", name: "heroImageUrl", label: "Hero image path", hint: "An image on Roavela (/media/… or /demo/…) or the image CDN.", defaultValue: d.heroImageUrl ?? "", maxLength: 500 },
              { type: "text", name: "seoTitle", label: "SEO title", defaultValue: d.seoTitle ?? "", maxLength: 70 },
              { type: "textarea", name: "seoDescription", label: "SEO description", defaultValue: d.seoDescription ?? "", rows: 2, maxLength: 170 },
              { type: "text", name: "latitude", label: "Latitude", required: true, inputMode: "decimal", defaultValue: String(d.latitude) },
              { type: "text", name: "longitude", label: "Longitude", required: true, inputMode: "decimal", defaultValue: String(d.longitude) },
              { type: "checkbox", name: "isPublished", label: "Published (has a public destination page)", defaultChecked: d.isPublished },
            ]}
          />
        </Card>
        <Card className="h-fit p-5">
          <h2 className="font-sans text-sm font-bold tracking-wider text-mist uppercase">Structure (read-only)</h2>
          <Facts
            className="mt-2 sm:grid-cols-1"
            items={[
              ["Slug", `/${d.slug}`],
              ["Kind", d.kind.toLowerCase()],
              ["Parent", d.parent?.name ?? "—"],
              ["Country", d.countryCode],
              ["Timezone", d.timezone],
              ["Trip origin", d.isOrigin ? "Yes" : "No"],
            ]}
          />
          <p className="mt-3 text-xs text-mist">Slugs and hierarchy drive search and drive-time data, so they aren&apos;t editable here.</p>
        </Card>
      </div>
    </>
  );
}
