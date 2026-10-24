package api

import "net/http"

func (a *API) dashboard(w http.ResponseWriter, r *http.Request) {
	result, err := a.store.Dashboard(r.Context(), userID(r))
	if err != nil {
		respondError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
