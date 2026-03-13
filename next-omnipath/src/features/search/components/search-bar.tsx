"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"

interface SearchBarProps {
  placeholder?: string
  onSearch: (query: string) => void
  isLoading?: boolean
  initialQuery?: string
  autoFocus?: boolean
  selectedSpecies?: string
  onSpeciesChange?: (species: string) => void
  showSpeciesSelector?: boolean
  className?: string
}

export function SearchBar({
  placeholder = "Search...",
  onSearch,
  isLoading = false,
  initialQuery = "",
  autoFocus = false,
  selectedSpecies = "9606",
  onSpeciesChange,
  showSpeciesSelector = true,
  className,
}: SearchBarProps) {
  const [query, setQuery] = useState(initialQuery)
  const debounceTimeout = useRef<NodeJS.Timeout | undefined>(undefined)
  const prevQueryRef = useRef(initialQuery)

  useEffect(() => {
    if (initialQuery !== prevQueryRef.current) {
      setQuery(initialQuery)
      prevQueryRef.current = initialQuery
    }
  }, [initialQuery])

  useEffect(() => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current)
    }

    if (query.trim() && query !== prevQueryRef.current) {
      debounceTimeout.current = setTimeout(() => {
        onSearch(query)
        prevQueryRef.current = query
      }, 300)
    }

    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current)
      }
    }
  }, [query, onSearch])

  const handleSearch = () => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current)
    }
    if (query.trim()) {
      onSearch(query)
      prevQueryRef.current = query
    }
  }

  return (
    <div className={`w-full relative group backdrop-blur-sm rounded-full transition-all focus-within:shadow-md focus-within:ring-2 focus-within:ring-primary/20 ${className}`}>
      <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary z-10" />
      <Input
        type="search"
        placeholder={placeholder}
        className={`w-full pl-12 ${showSpeciesSelector ? 'pr-[240px]' : 'pr-[100px]'} h-12 text-lg rounded-full shadow-sm transition-all focus:shadow-md focus:ring-2 focus:ring-primary/20`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
        }}
        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        autoFocus={autoFocus}
      />
      {showSpeciesSelector && (
        <div className="absolute right-28 top-1/2 z-10 -translate-y-1/2">
          <select
            value={selectedSpecies}
            onChange={(event) => onSpeciesChange?.(event.target.value)}
            className="h-8 rounded-md border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none outline-none"
          >
            <option value="9606">Human</option>
            <option value="10090">Mouse</option>
            <option value="10116">Rat</option>
            <option value="7227">Fruit fly</option>
            <option value="6239">C. elegans</option>
            <option value="7955">Zebrafish</option>
          </select>
        </div>
      )}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2 z-10">
        <Button
          onClick={handleSearch}
          disabled={isLoading}
          className="h-8 px-4 rounded-full shadow-sm transition-all hover:shadow-md"
        >
          Search
        </Button>
      </div>
    </div>
  )
}