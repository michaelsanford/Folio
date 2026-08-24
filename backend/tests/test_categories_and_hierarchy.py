from app.models.category import CategoryType


def test_list_and_seed_categories(client):
    resp = client.get("/api/categories")
    assert resp.status_code == 200
    categories = resp.json()
    assert len(categories) > 0

    # Ensure default essential categories exist
    slugs = [c["slug"] for c in categories]
    assert "income" in slugs
    assert "groceries" in slugs
    assert "housing" in slugs
    assert "mortgage-principal" in slugs


def test_create_parent_and_child_categories(client):
    # 1. Create Parent Category
    parent_resp = client.post(
        "/api/categories",
        json={
            "name": "Personal Care",
            "type": CategoryType.EXPENSE.value,
            "color": "#ec4899",
            "icon": "Sparkles",
        },
    )
    assert parent_resp.status_code == 201
    parent = parent_resp.json()
    assert parent["name"] == "Personal Care"
    assert parent["slug"] == "personal-care"

    # 2. Create Child Category
    child_resp = client.post(
        "/api/categories",
        json={
            "name": "Haircuts",
            "type": CategoryType.EXPENSE.value,
            "parent_id": parent["id"],
            "color": "#f472b6",
        },
    )
    assert child_resp.status_code == 201
    child = child_resp.json()
    assert child["parent_id"] == parent["id"]

    # 3. Retrieve Hierarchical Tree
    tree_resp = client.get("/api/categories/tree")
    assert tree_resp.status_code == 200
    tree = tree_resp.json()
    found_parent = next((node for node in tree if node["id"] == parent["id"]), None)
    assert found_parent is not None
    assert len(found_parent["children"]) == 1
    assert found_parent["children"][0]["name"] == "Haircuts"


def test_update_and_delete_category(client):
    # Create category
    create_resp = client.post(
        "/api/categories",
        json={
            "name": "Gym & Fitness",
            "type": CategoryType.EXPENSE.value,
            "color": "#10b981",
        },
    )
    cat_id = create_resp.json()["id"]

    # Update
    update_resp = client.put(
        f"/api/categories/{cat_id}",
        json={"name": "Health & Fitness", "color": "#059669"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["name"] == "Health & Fitness"
    assert update_resp.json()["color"] == "#059669"

    # Delete
    del_resp = client.delete(f"/api/categories/{cat_id}")
    assert del_resp.status_code == 204
