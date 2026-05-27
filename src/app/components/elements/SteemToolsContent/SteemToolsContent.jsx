import React from "react";
import { SteemToolsMenu, DEFAULT_MENU_DATA } from "./SteemToolsMenu";
import ClaimDiscounted from "./sections/ClaimDiscounted";
import KeyGeneration from "./sections/KeyGeneration";
import CreateAccount from "./sections/CreateAccount";
import ChangeRecovery from "./sections/ChangeRecovery";
import AuthorityManagement from "./sections/AuthorityManagement";
import UpdateProxy from "./sections/UpdateProxy";
import DeclineVoting from "./sections/DeclineVoting";
import CreateWitness from "./sections/CreateWitness";
import GenerateBrainKeys from "./sections/GenerateBrainKeys";
import PublishPriceFeed from "./sections/PublishPriceFeed";
import DisableWitness from "./sections/DisableWitness";


class SteemToolsContent extends React.Component {
  constructor(props) {
    super(props);

    this.DESKTOP_MIN = 900;

    this.state = {
      collapsed: false,
      activeItemId: props.defaultKey || "claim-discounted",
      activeCategoryId: null,
      query: "",
      variant: "collapsible",
      isDesktop: false,
    };

    this.handleToggle = this.handleToggle.bind(this);
    this.handleSelectItem = this.handleSelectItem.bind(this);
    this.scrollContentTop = this.scrollContentTop.bind(this);
    this.renderContent = this.renderContent.bind(this);
    this.getCategorySectionIds = this.getCategorySectionIds.bind(this);
    this.onResize = this.onResize.bind(this);
  }

  componentDidMount() {
    this.onResize();
    window.addEventListener("resize", this.onResize);
    this.scrollContentTop();
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.onResize);
  }

  onResize() {
    var isDesktopNow = window.innerWidth >= this.DESKTOP_MIN;

    this.setState(function (s) {
      if (s.isDesktop === isDesktopNow) return null;

      return {
        isDesktop: isDesktopNow,
        collapsed: isDesktopNow ? false : true,
      };
    });
  }

  scrollContentTop() {
    if (this._contentRef) {
      this._contentRef.scrollTop = 0;
    }
  }

  handleToggle() {
    this.setState(function (s) {
      return { collapsed: !s.collapsed };
    });
  }

  handleSelectItem(item) {
    var shouldAutoClose = (this.state.variant === "collapsible") && !this.state.isDesktop;

    this.setState({
      activeItemId: item.id,
      activeCategoryId: null,
      collapsed: shouldAutoClose ? true : this.state.collapsed,
    });

    this.scrollContentTop();
    if (this.props.onSelect) this.props.onSelect(item);
  }

  getCategorySectionIds(menuData, categoryId) {
    var sec = (menuData || []).filter(function (s) {
      return s.id === categoryId;
    })[0];
    if (!sec) return [];
    return (sec.items || []).map(function (it) {
      return it.id;
    });
  }

  renderContent(sectionId) {
    switch (sectionId) {
      case "claim-discounted": return <ClaimDiscounted accountname={this.props.accountname} />;
      case "key-generation": return <KeyGeneration />;
      case "create-account": return <CreateAccount accountname={this.props.accountname} />;

      case "change-recovery": return <ChangeRecovery accountname={this.props.accountname} />;
      case "authority-management": return <AuthorityManagement accountname={this.props.accountname} />;

      case "update-proxy": return <UpdateProxy accountname={this.props.accountname} />;
      case "decline-voting": return <DeclineVoting accountname={this.props.accountname} />;

      case "create-witness": return <CreateWitness accountname={this.props.accountname} />;
      case "generate-brain-keys": return <GenerateBrainKeys accountname={this.props.accountname} />;
      case "publish-price-feed": return <PublishPriceFeed accountname={this.props.accountname} />;
      case "disable-witness": return <DisableWitness accountname={this.props.accountname} />;

      default:
        return (<div></div>);
    }
  }

  render() {
    var palette = this.props.menuData || DEFAULT_MENU_DATA;
    var collapsed = this.state.collapsed;
    var variant = this.state.variant;

    var wrapperClass = [
      "advtools-wrapper",
      collapsed && variant === "collapsible" ? "collapsed" : "",
    ].filter(Boolean).join(" ");

    var sectionIds = [];
    if (this.state.activeCategoryId) {
      sectionIds = this.getCategorySectionIds(palette, this.state.activeCategoryId);
    } else if (this.state.activeItemId) {
      sectionIds = [this.state.activeItemId];
    }

    return (
        <div className="row">
            <div className="column">
                <div className={wrapperClass}>
                    <SteemToolsMenu
                        variant={variant}
                        collapsed={collapsed}
                        activeItemId={this.state.activeItemId}
                        query={this.state.query}
                        menuData={palette}
                        onSelectItem={this.handleSelectItem}
                    />

                    <button
                        type="button"
                        className="advtools-toggle"
                        onClick={this.handleToggle}
                        aria-label={collapsed ? "Open menu" : "Close menu"}
                        title={collapsed ? "Open menu" : "Close menu"}
                    >
                        <span
                            className={
                                "advtools-toggle-chevron" + (collapsed ? " flipped" : "")
                            }
                        />
                    </button>

                    {!this.state.isDesktop && !collapsed && (
                        <div className="advtools-overlay" onClick={this.handleToggle} />
                    )}

                    <div
                        className="advtools-content"
                        ref={function (r) { this._contentRef = r; }.bind(this)}
                    >
                    {sectionIds.map(function (id) {
                        return (
                        <div key={id} style={{ marginBottom: 24 }}>
                            {this.renderContent(id)}
                        </div>
                        );
                    }.bind(this))}
                    </div>
                </div>

            </div>
        </div>
    );
  }
}

export default SteemToolsContent;
