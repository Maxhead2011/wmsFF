import { useEffect, useState } from 'react';
import { fetchLogisticsDestinationSuggestions } from '../../lib/api';
import type { KnownValueOption } from '../common/KnownValueInput';

export function useLogisticsDestinationOptions(accessToken: string) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<KnownValueOption[]>([]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      fetchLogisticsDestinationSuggestions(accessToken, { search: search || undefined })
        .then((suggestions) =>
          setOptions(
            suggestions.map((suggestion) => ({
              value: suggestion.value,
              label: suggestion.label,
              description: suggestion.description,
              data: {
                tariffSetId: suggestion.tariffSetId,
                tariffSetName: suggestion.tariffSetName,
                origin: suggestion.origin,
              },
            })),
          ),
        )
        .catch(() => setOptions([]));
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [accessToken, search]);

  return {
    options,
    search: setSearch,
  };
}
