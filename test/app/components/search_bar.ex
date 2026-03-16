defmodule Blog.Components.SearchBar do
  use Hologram.Component

  prop(:query, :string, default: "")
  prop(:placeholder, :string, default: "Search posts...")

  def template do
    ~HOLO"""
    <div class="search-bar">
      <input
        type="text"
        value={@query}
        placeholder={@placeholder}
        $change="update_search"
      />

      {%if @query != ""}
        <button $click="clear_search" class="clear-btn">&times;</button>
      {/if}
    </div>
    """
  end
end
