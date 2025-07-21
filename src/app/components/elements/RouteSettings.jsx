import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import Icon from 'app/components/elements/Icon';

class RouteSettings extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            broadcasting: false,
            errorMessage: undefined,
            proxyAccount: '',
            percentage: 100,
            autoVest: false,
        };
    }

    componentDidMount() {
        this.updateRemainingPercentage(this.props.withdraw_routes);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.withdraw_routes !== this.props.withdraw_routes) {
            this.updateRemainingPercentage(this.props.withdraw_routes);
        }
    }

    updateRemainingPercentage = (routes) => {
        if (!routes) return;
        const totalRoutedPercentage = routes.reduce((total, route) => total + route.percent, 0);
        const remainingPercentage = 100 - (totalRoutedPercentage / 100);
        this.setState({ percentage: remainingPercentage });
    }

    removeWithdrawRoute = (toAccount) => {
        this.setState({ broadcasting: true, errorMessage: undefined });
        const { account, setWithdrawVestingRoute } = this.props;

        // To remove a route, you set the percent to 0
        setWithdrawVestingRoute({
            account,
            proxy: toAccount,
            percent: 0,
            autoVest: false,
            successCallback: () => this.setState({ broadcasting: false }),
            errorCallback: (error) => this.setState({ broadcasting: false, errorMessage: String(error) }),
        });
    };

    setWithdrawRoute = (e) => {
        e.preventDefault();
        this.setState({ broadcasting: true, errorMessage: undefined });

        const { account, setWithdrawVestingRoute, hideModal } = this.props;
        const { proxyAccount, percentage, autoVest } = this.state;

        setWithdrawVestingRoute({
            account,
            proxy: proxyAccount,
            percent: Math.round(percentage * 100), // API expects percentage * 100
            autoVest,
            successCallback: () => {
                this.setState({ broadcasting: false });
                hideModal(); // Close modal on success
            },
            errorCallback: (error) => {
                this.setState({ broadcasting: false, errorMessage: String(error) });
            },
        });
    };

    handleInputChange = (event) => {
        const { name, value } = event.target;
        this.setState({ [name]: value });
    };
    
    handleCheckboxChange = (event) => {
        const { name, checked } = event.target;
        this.setState({ [name]: checked });
    }

    render() {
        if (!this.props.account) return null; // Render nothing if account data is not available yet

        const { broadcasting, errorMessage, proxyAccount, percentage, autoVest } = this.state;
        const { withdraw_routes, hideModal } = this.props;

        let totalRoutedPercentage = 0;
        const currentRoutesList = withdraw_routes && withdraw_routes.map(route => {
            totalRoutedPercentage += route.percent;
            return (
                <div key={route.to_account} className="row" style={{ borderBottom: '1px solid #eee', padding: '0.5rem 0', display: 'flex', alignItems: 'center' }}>
                    <div className="column">
                        <div><strong>@{route.to_account}</strong></div>
                        <div className="secondary" style={{fontSize: '0.9rem'}}>{route.percent / 100}% of power down</div>
                    </div>
                    <div className="column shrink">
                        <button className="button alert hollow circle" style={{marginBottom: 0, width: '2rem', height: '2rem', lineHeight: '2rem', padding: 0}} onClick={() => this.removeWithdrawRoute(route.to_account)} title={tt('g.remove')}>
                            <span style={{fontSize: '1.5rem', fontWeight: 'bold', lineHeight: '1rem'}}>&times;</span>
                        </button>
                    </div>
                </div>
            );
        });

        const remainingPercentage = 100 - (totalRoutedPercentage / 100);

        const currentRoutes = (
            <div className="WithdrawRoutes">
                <h4 style={{marginBottom: '0.25rem'}}>Current Withdraw Routes</h4>
                <p className="secondary">Your active power down routing configurations.</p>
                <div style={{ marginBottom: '1rem' }}>
                    {withdraw_routes && withdraw_routes.length > 0 ? currentRoutesList : <p>No withdraw routes are set.</p>}
                </div>
                {withdraw_routes && withdraw_routes.length > 0 && (
                     <div className="callout" style={{ backgroundColor: '#f7f7f7', padding: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Total routed:</span> <strong>{totalRoutedPercentage / 100}%</strong>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>Remaining to you:</span> <strong>{remainingPercentage}%</strong>
                        </div>
                    </div>
                )}
            </div>
        );

        return (
            <div className="RouteSettingsModal" style={{ padding: '1.5rem', maxWidth: '38rem', margin: '0 auto' }}>
                <div className="row">
                    <h3 className="column" style={{marginBottom: '1rem'}}>{tt('userwallet_jsx.advanced_routes')}</h3>
                </div>
                
                {currentRoutes}

                <hr />

                <h4 style={{marginBottom: '0.25rem'}}>Add New Route</h4>
                <div className="row">
                    <div className="column small-12">
                        <label>
                            Route To Account
                            <input
                                type="text"
                                name="proxyAccount"
                                value={proxyAccount}
                                onChange={this.handleInputChange}
                                placeholder="Account to receive power down payments"
                                autoComplete="off"
                            />
                        </label>
                        <label>
                            Percentage (0-{remainingPercentage}%)
                            <input
                                type="number"
                                name="percentage"
                                value={percentage}
                                min="0"
                                max={remainingPercentage}
                                onChange={this.handleInputChange}
                            />
                        </label>
                         <label style={{marginBottom: '1rem'}}>
                            <input
                                type="checkbox"
                                name="autoVest"
                                checked={autoVest}
                                onChange={this.handleCheckboxChange}
                            />
                            &nbsp; Auto Vest
                             <div className="secondary" style={{fontSize: '0.8rem', paddingTop: '5px'}}>When enabled, funds will be automatically converted to STEEM Power in the recipient account.</div>
                        </label>
                    </div>
                </div>

                <div className="row">
                    <div className="column small-12">
                         <div className="callout info">
                            <p style={{marginBottom: '0.5rem'}}><strong>Withdraw Route Information:</strong></p>
                            <ul style={{marginBottom: 0}}>
                                <li>This only sets up routing rules for future power downs.</li>
                                <li>You must still initiate a power down separately.</li>
                                <li>Auto-vest converts payments directly to STEEM Power.</li>
                            </ul>
                        </div>
                        {errorMessage && <div className="callout alert"><p>{errorMessage}</p></div>}
                    </div>
                </div>

                <div className="row">
                    <div className="column small-12" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                         <button type="button" className="button hollow" onClick={hideModal} style={{marginBottom: 0, marginRight: '0.5rem'}}>
                            {tt('g.cancel')}
                        </button>
                        <button
                            type="submit"
                            className="button"
                            onClick={this.setWithdrawRoute}
                            disabled={broadcasting || !proxyAccount || percentage <= 0}
                            style={{marginBottom: 0}}
                        >
                            {tt('g.continue')}
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}

export default connect(
    (state, ownProps) => {
        const values = state.user.get('advanced_defaults');
        if (!values) return { ...ownProps, account: null, withdraw_routes: [] };

        const accountName = values.get('account');
        const routes = state.user.get('withdraw_routes');
        
        const withdraw_routes = routes && routes.toJS ? routes.toJS() : [];

        return { 
            ...ownProps, 
            account: accountName,
            withdraw_routes,
        };
    },
    (dispatch) => ({
        hideModal: () => {
            dispatch(userActions.hideAdvanced());
        },
        setWithdrawVestingRoute: ({
            account,
            proxy,
            percent,
            autoVest,
            successCallback,
            errorCallback,
        }) => {
             const successCallbackWrapper = (...args) => {
                // Refresh account data after transaction
                dispatch(userActions.getWithdrawRoutes({ account }));
                if (successCallback) return successCallback(...args);
            };
            const isRemove = percent === 0;
             dispatch(
                transactionActions.broadcastOperation({
                    type: 'set_withdraw_vesting_route',
                    operation: {
                        from_account: account,
                        to_account: proxy,
                        percent: percent,
                        auto_vest: autoVest,
                    },
                    confirm: isRemove
                        ? tt('g.are_you_sure')
                        : tt('userwallet_jsx.confirm_route_setup', {
                              percent: percent / 100,
                              account: proxy,
                          }),
                    successCallback: successCallbackWrapper,
                    errorCallback,
                })
            );
        },
    })
)(RouteSettings);
