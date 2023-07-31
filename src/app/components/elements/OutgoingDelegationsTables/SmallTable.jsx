import React from 'react';
import { Link } from 'react-router';
import tt from 'counterpart';
import TimeAgoWrapper from 'app/components/elements/TimeAgoWrapper';
import Icon from 'app/components/elements/Icon';
import { numberWithCommas } from 'app/utils/StateFunctions';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import { ASC, DELEGATEE, DATE, AMOUNT } from './constants'

class SmallTable extends React.Component {
    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'Table');
    }
    render() {
        const {
            sortData,
            vestingDelegations,
            sortBy,
            sort,
            isMyAccount,
            convertVestsToSteem,
            updateClipboard,
            showTransferHandler,
            total
        } = this.props

        return (
            <table>
                <thead>
                    <tr>
                        <th style={{ minWidth: '100%' }}>
                            <span style={{ display: 'flex', flexDirection: 'column', float: 'left', marginLeft: 0, minWidth: '100%', gap: "0.5rem" }}>
                                <span
                                    onClick={() => { sortData(DELEGATEE) }}
                                >
                                    {`${tt('outgoingdelegations_jsx.delegatee')} (${total})`}
                                    <span className={sortBy === DELEGATEE ? "icon--active" : ""}>
                                        {sort !== ASC
                                            ? (<Icon name="dropdown-arrow" />)
                                            : (<Icon name="dropdown-arrow" className="up-arrow" style={{ transform: 'rotate(180deg)' }} />)
                                        }
                                    </span>
                                </span>
                                <span
                                    onClick={() => { sortData(AMOUNT) }}
                                >
                                    {tt('outgoingdelegations_jsx.amount_delegated')}
                                    <span className={sortBy === AMOUNT ? "icon--active" : ""}>
                                        {sort !== ASC
                                            ? (<Icon name="dropdown-arrow" />)
                                            : (<Icon name="dropdown-arrow" className="up-arrow" style={{ transform: 'rotate(180deg)' }} />)
                                        }
                                    </span>
                                </span>
                                <span
                                    onClick={() => { sortData(DATE) }}
                                >
                                    {tt('outgoingdelegations_jsx.start_date')}
                                    <span className={sortBy === DATE ? "icon--active" : ""}>
                                        {sort !== ASC
                                            ? (<Icon name="dropdown-arrow" />)
                                            : (<Icon name="dropdown-arrow" className="up-arrow" style={{ transform: 'rotate(180deg)' }} />)
                                        }
                                    </span>
                                </span>
                            </span>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {vestingDelegations.map((item) => {
                        const vestsAsSteem = convertVestsToSteem(
                            parseFloat(item.vesting_shares)
                        );
                        return (<tr
                            key={`${item.delegator}--${item.delegatee}--${item.min_delegation_time}`}
                        >
                            {isMyAccount
                                ? (<td
                                    className="delegations__revoke button hollow"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        showTransferHandler(item.delegatee);
                                    }}
                                    style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
                                >
                                    <span>
                                        <Link to={`/@${item.delegatee}`}>
                                            {item.delegatee}
                                        </Link>
                                    </span>
                                    <span
                                        style={{cursor: "pointer"}}
                                        title={`${parseFloat(item.vesting_shares)} VESTS`}
                                        onClick={() => { updateClipboard(`${numberWithCommas(vestsAsSteem)} SP`) }}
                                    >
                                        {`${numberWithCommas(vestsAsSteem)} SP`}
                                    </span>
                                    <span
                                        className="text--capitalize"
                                        onClick={() => { updateClipboard(item.min_delegation_time) }}
                                        style={{cursor: "pointer"}}
                                    >
                                        <TimeAgoWrapper date={item.min_delegation_time} />
                                    </span>
                                </td>)
                                : (<td
                                    style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                                    <span
                                        style={{textTransform: "uppercase"}}
                                    >
                                        <Link to={`/@${item.delegatee}`}>
                                            {item.delegatee}
                                        </Link>
                                    </span>
                                    <span 
                                        style={{cursor: "pointer"}}
                                        title={`${parseFloat(item.vesting_shares)} VESTS`}
                                        onClick={() => { updateClipboard(`${numberWithCommas(vestsAsSteem)} SP`) }}
                                    >
                                        {`${numberWithCommas(vestsAsSteem)} SP`}
                                    </span>
                                    <span
                                        className="text--capitalize"
                                        style={{cursor: "pointer"}}
                                        onClick={() => { updateClipboard(item.min_delegation_time) }}
                                    >
                                        <TimeAgoWrapper date={item.min_delegation_time} />
                                    </span>
                                </td>)
                            }
                        </tr>
                        )
                    })
                    }
                </tbody>
            </table>
        )
    }
}
export default SmallTable;
