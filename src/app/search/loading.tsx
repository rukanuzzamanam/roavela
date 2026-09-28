import { Skeleton } from "@/components/ui/feedback";

export default function SearchLoading() {
  return (
    <div className="container-page pt-8 pb-10" aria-busy="true" aria-label="Loading stays">
      <Skeleton className="mb-8 h-24 w-full rounded-[1.75rem]" />
      <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
        <Skeleton className="hidden h-[32rem] lg:block" />
        <div>
          <Skeleton className="mb-2 h-10 w-2/3" />
          <Skeleton className="mb-8 h-5 w-32" />
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <Skeleton className="aspect-[4/3]" />
                <Skeleton className="mt-3 h-4 w-1/2" />
                <Skeleton className="mt-2 h-6 w-3/4" />
                <Skeleton className="mt-2 h-4 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
