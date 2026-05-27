import React from "react";
import tt from 'counterpart';

const DEFAULT_MENU_DATA = [
  {
    id: 'account-creation',
    title: tt('steem_tools.menu.account_creation'),
    items: [
      { id: 'claim-discounted', label: tt('steem_tools.menu.claim_account_creation_token') },
      { id: 'key-generation', label: tt('steem_tools.menu.key_generator') },
      { id: 'create-account', label: tt('steem_tools.menu.create_account') },
    ],
  },
  {
    id: 'account-security',
    title: tt('steem_tools.menu.account_security'),
    items: [
      { id: 'change-recovery', label: tt('steem_tools.menu.change_recovery_account') },
      { id: 'authority-management', label: tt('steem_tools.menu.authority_management') },
    ],
  },
  {
    id: 'governance',
    title: tt('steem_tools.menu.governance'),
    items: [
      { id: 'update-proxy', label: tt('steem_tools.menu.update_proxy') },
      { id: 'decline-voting', label: tt('steem_tools.menu.decline_voting_rights') },
    ],
  },
  {
    id: 'witness-operations',
    title: tt('steem_tools.menu.witness_operations'),
    items: [
      { id: 'create-witness', label: tt('steem_tools.menu.create_update_witness') },
      { id: 'generate-brain-keys', label: tt('steem_tools.menu.generate_brain_keys') },
      { id: 'publish-price-feed', label: tt('steem_tools.menu.publish_witness_price_feed') },
      { id: 'disable-witness', label: tt('steem_tools.menu.disable_witness') },
    ],
  },
];

class SteemToolsMenu extends React.Component {
  constructor(props) {
    super(props);
    this.handleSelectItem = this.handleSelectItem.bind(this);
  }

  handleSelectItem(item) {
    if (this.props.onSelectItem) this.props.onSelectItem(item);
  }

  filterItems(menu, query) {
    if (!query) return menu;
    var q = String(query || "").toLowerCase();
    return (menu || [])
      .map(function (sec) {
        return {
          id: sec.id,
          title: sec.title,
          items: (sec.items || []).filter(function (it) {
            return it.label.toLowerCase().indexOf(q) !== -1;
          }),
        };
      })
      .filter(function (sec) {
        return sec.items.length > 0;
      });
  }

  render() {
    var menuData = this.props.menuData || DEFAULT_MENU_DATA;
    var filtered = this.filterItems(menuData, this.props.query);
    var collapsed = !!this.props.collapsed;
    var variant = this.props.variant || "collapsible";
    var activeItemId = this.props.activeItemId;

    return (
      <div
        className={
          "advtools-sidebar" +
          (collapsed && variant === "collapsible" ? " is-collapsed" : "")
        }
        role="navigation"
        aria-label="Steem tools menu"
      >
        <div className="advtools-scroll">
          {filtered.map(function (section) {
            return (
              <div className="advtools-menu-section" key={section.id}>
                <div className="advtools-section-title">
                  <span>{section.title}</span>
                </div>

                {section.items.map(function (item) {
                  return (
                    <div
                      key={item.id}
                      className={
                        "advtools-item" +
                        (activeItemId === item.id ? " active" : "")
                      }
                      onClick={function () {
                        return this.handleSelectItem(item);
                      }.bind(this)}
                      role="button"
                      tabIndex={0}
                    >
                      <div>{item.label}</div>
                    </div>
                  );
                }.bind(this))}
              </div>
            );
          }.bind(this))}
        </div>
      </div>
    );
  }
}

export { SteemToolsMenu, DEFAULT_MENU_DATA };
