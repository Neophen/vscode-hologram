defmodule Blog.PlacePage do
  use Hologram.Page

  route("/places/:id")

  param(:id, :uuid)

  layout(Blog.MainLayout)

  def init(params, component, _server) do
    place = Ash.DataLayer.load!(Octafest.Platform.Place, params.id)
    put_state(component, :place, place)
  end

  def template do
    ~HOLO"""
    <article class="place-page">
      <header>
        <h1>{@place.title}</h1>
      </header>
    </article>
    """
  end
end
